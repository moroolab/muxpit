use crate::platform::command::silent_command;
use crate::shell_quote::quote_posix_shell_arg;
use crate::ssh_command::SshCommand;
use std::fs::File;
use std::io;
use std::path::Path;
use std::process::Stdio;

/// Same side-channel allowlist as the clipboard image upload: no tty, no port
/// forwards, no pane remote command, so binary stdin reaches remote `cat`.
const FILE_UPLOAD_OPTION_ALLOWLIST: &[&str] = &["-p", "-i", "-J", "-F", "-o", "-l"];

const MAX_FILE_NAME_LEN: usize = 255;

/// Remote side of a file drop. Expects `muxpit_name` to be assigned before
/// this runs. Dropped files are meant to stick around, so an existing name is
/// never overwritten: `report.pdf` becomes `report-2.pdf`, `report-3.pdf`, ...
/// Only the final extension is preserved (`a.tar.gz` -> `a.tar-2.gz`).
pub const REMOTE_FILE_UPLOAD_SCRIPT: &str = "umask 077; dir=\"$HOME/.muxpit/files\"; \
     mkdir -p \"$dir\" && \
     base=\"${muxpit_name%.*}\"; ext=\"${muxpit_name##*.}\"; \
     if [ -z \"$base\" ] || [ \"$base\" = \"$muxpit_name\" ]; then base=\"$muxpit_name\"; ext=\"\"; else ext=\".$ext\"; fi; \
     muxpit_file_path=\"$dir/$muxpit_name\"; n=2; \
     while [ -e \"$muxpit_file_path\" ]; do muxpit_file_path=\"$dir/$base-$n$ext\"; n=$((n+1)); done; \
     cat > \"$muxpit_file_path\" && chmod 600 \"$muxpit_file_path\" && printf '%s\\n' \"$muxpit_file_path\"";

/// Extracts a safe remote file name from a dropped local path. Only the final
/// component is used; separators, control characters, and `.`/`..` are refused
/// rather than sanitized so the user sees why an upload was skipped.
pub fn dropped_file_name(path: &Path) -> Result<String, String> {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("invalid file name: {}", path.display()))?;
    if name.is_empty() || name == "." || name == ".." {
        return Err(format!("invalid file name: {}", path.display()));
    }
    if name.len() > MAX_FILE_NAME_LEN {
        return Err(format!("file name too long: {name}"));
    }
    if name
        .chars()
        .any(|ch| ch.is_control() || ch == '/' || ch == '\\')
    {
        return Err(format!("unsupported characters in file name: {name}"));
    }
    Ok(name.to_string())
}

/// Mirrors the shell suffix rule so the naming contract is pinned by a unit
/// test on this side too.
pub fn suffixed_file_name(name: &str, n: u32) -> String {
    match name.rfind('.') {
        Some(0) | None => format!("{name}-{n}"),
        Some(dot) => format!("{}-{n}{}", &name[..dot], &name[dot..]),
    }
}

pub fn file_upload_remote_command(name: &str) -> String {
    format!(
        "muxpit_name={}; {REMOTE_FILE_UPLOAD_SCRIPT}",
        quote_posix_shell_arg(name)
    )
}

pub fn file_upload_ssh_args(ssh: &SshCommand, name: &str) -> Vec<String> {
    let mut args = ssh.filtered_options(FILE_UPLOAD_OPTION_ALLOWLIST);
    args.extend([
        "-o".to_string(),
        "ConnectTimeout=10".to_string(),
        "-o".to_string(),
        "BatchMode=yes".to_string(),
        "-o".to_string(),
        "StrictHostKeyChecking=accept-new".to_string(),
    ]);
    args.push(ssh.target.clone());
    args.push(file_upload_remote_command(name));
    args
}

/// Streams a dropped local file to the pane's SSH host and returns the remote
/// path. The file is piped straight from disk to ssh stdin; nothing is
/// base64-encoded or buffered in memory.
pub fn push_file_to_remote_sync(ssh: &SshCommand, local_path: &str) -> Result<String, String> {
    let path = Path::new(local_path);
    let metadata = std::fs::metadata(path)
        .map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    if metadata.is_dir() {
        return Err(format!(
            "directories are not uploaded: {}",
            path.display()
        ));
    }
    let name = dropped_file_name(path)?;
    let mut file = File::open(path).map_err(|e| format!("cannot open {}: {e}", path.display()))?;

    let mut cmd = silent_command(&ssh.program);
    cmd.args(file_upload_ssh_args(ssh, &name));
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("ssh spawn failed: {e}"))?;
    {
        let mut stdin = child.stdin.take().ok_or("ssh stdin unavailable")?;
        io::copy(&mut file, &mut stdin).map_err(|e| format!("upload failed: {e}"))?;
    }
    let out = child
        .wait_with_output()
        .map_err(|e| format!("ssh failed: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!("upload failed: {}", err.trim()));
    }
    let remote = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if remote.is_empty() {
        return Err("upload failed: remote returned no path".into());
    }
    Ok(remote)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn dropped_file_name_uses_final_component_only() {
        assert_eq!(
            dropped_file_name(Path::new("/home/me/docs/report.pdf")).unwrap(),
            "report.pdf"
        );
        assert_eq!(
            dropped_file_name(&PathBuf::from(r"C:\Users\me\notes.txt")).unwrap(),
            "notes.txt"
        );
    }

    #[test]
    fn dropped_file_name_rejects_unsafe_names() {
        assert!(dropped_file_name(Path::new("/")).is_err());
        assert!(dropped_file_name(Path::new("/tmp/..")).is_err());
        assert!(dropped_file_name(Path::new("/tmp/bad\nname")).is_err());
        assert!(dropped_file_name(Path::new(&format!("/tmp/{}", "x".repeat(300)))).is_err());
    }

    #[test]
    fn suffix_rule_keeps_final_extension() {
        assert_eq!(suffixed_file_name("report.pdf", 2), "report-2.pdf");
        assert_eq!(suffixed_file_name("a.tar.gz", 3), "a.tar-3.gz");
        assert_eq!(suffixed_file_name("Makefile", 2), "Makefile-2");
        assert_eq!(suffixed_file_name(".env", 2), ".env-2");
    }

    #[test]
    fn remote_script_never_overwrites_and_avoids_mktemp() {
        assert!(REMOTE_FILE_UPLOAD_SCRIPT.contains("while [ -e"));
        assert!(REMOTE_FILE_UPLOAD_SCRIPT.contains("muxpit_file_path="));
        assert!(!REMOTE_FILE_UPLOAD_SCRIPT.contains("mktemp"));
        assert!(!REMOTE_FILE_UPLOAD_SCRIPT.contains(" path="));
    }

    #[test]
    fn remote_command_quotes_the_file_name() {
        let command = file_upload_remote_command("it's here.txt");
        assert!(command.starts_with("muxpit_name='it'\\''s here.txt'; "));
        assert!(command.ends_with(REMOTE_FILE_UPLOAD_SCRIPT));
    }

    #[test]
    fn upload_args_keep_only_side_channel_safe_ssh_options() {
        let ssh = SshCommand {
            program: "ssh".to_string(),
            options: vec![
                "-t".to_string(),
                "-p".to_string(),
                "2222".to_string(),
                "-L".to_string(),
                "8080:localhost:80".to_string(),
            ],
            target: "me@host".to_string(),
            tty_mode: None,
        };

        let args = file_upload_ssh_args(&ssh, "report.pdf");

        assert!(args.windows(2).any(|pair| pair == ["-p", "2222"]));
        assert!(!args.iter().any(|arg| arg == "-t"));
        assert!(!args.iter().any(|arg| arg == "-L"));
        assert_eq!(args[args.len() - 2], "me@host");
        assert!(args.last().unwrap().starts_with("muxpit_name='report.pdf'; "));
    }

    #[test]
    fn upload_rejects_directories_before_spawning_ssh() {
        let ssh = SshCommand {
            program: "ssh".to_string(),
            options: Vec::new(),
            target: "me@host".to_string(),
            tty_mode: None,
        };
        let dir = std::env::temp_dir();

        let err = push_file_to_remote_sync(&ssh, dir.to_str().unwrap()).unwrap_err();
        assert!(err.contains("directories are not uploaded"));
    }

    #[test]
    fn upload_reports_missing_files_before_spawning_ssh() {
        let ssh = SshCommand {
            program: "ssh".to_string(),
            options: Vec::new(),
            target: "me@host".to_string(),
            tty_mode: None,
        };

        let err = push_file_to_remote_sync(&ssh, "/definitely/not/here.bin").unwrap_err();
        assert!(err.contains("cannot read"));
    }
}
