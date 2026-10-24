//! Native task-completion chime on Linux desktop (#242).
//!
//! WebKitGTK routes `<audio>` through GStreamer. AppImages that bundle only
//! core GStreamer libraries (no sink plugins) can abort the WebKit renderer when
//! playback starts. Desktop Linux plays the same asset via rodio/cpal instead.

#[cfg(target_os = "linux")]
const BELL_OGG: &[u8] = include_bytes!("../../src/assets/bell.ogg");

/// Fire-and-forget playback; errors are logged and never propagated to the UI.
pub fn play() {
    #[cfg(target_os = "linux")]
    {
        std::thread::spawn(|| {
            if let Err(e) = play_on_thread() {
                eprintln!("completion sound: {e}");
            }
        });
    }
}

#[cfg(target_os = "linux")]
fn play_on_thread() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use rodio::{Decoder, OutputStream, Sink};
    use std::io::Cursor;

    let (_stream, stream_handle) = OutputStream::try_default()?;
    let sink = Sink::try_new(&stream_handle)?;
    let source = Decoder::new(Cursor::new(BELL_OGG))?;
    sink.append(source);
    sink.sleep_until_end();
    Ok(())
}

#[cfg(target_os = "linux")]
#[cfg(test)]
mod tests {
    use super::play_on_thread;

    #[test]
    fn play_on_thread_does_not_panic_without_output() {
        // CI runners may lack a default audio device; must fail gracefully.
        let _ = play_on_thread();
    }
}
