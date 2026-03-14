let mediaRecorder = null;
let audioChunks = [];

const icon = document.getElementById('icon');
const label = document.getElementById('label');
const status = document.getElementById('status');

async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
  audioChunks = [];

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) audioChunks.push(e.data);
  };

  mediaRecorder.start();
  status.classList.add('recording');
  label.textContent = 'Listening...';
}

async function stopRecording() {
  return new Promise((resolve) => {
    mediaRecorder.onstop = async () => {
      const blob = new Blob(audioChunks, { type: 'audio/webm' });
      const arrayBuffer = await blob.arrayBuffer();
      const uint8 = Array.from(new Uint8Array(arrayBuffer));
      // Stop all tracks
      mediaRecorder.stream.getTracks().forEach((t) => t.stop());
      resolve(uint8);
    };
    mediaRecorder.stop();
  });
}

window.ada.onToggleRecording(async (recording) => {
  if (recording) {
    await startRecording();
  } else {
    status.classList.remove('recording');
    label.textContent = 'Processing...';

    const audioBuffer = await stopRecording();
    const result = await window.ada.transcribe(audioBuffer);

    if (result.success) {
      label.textContent = 'Pasted! Ctrl+Shift+Space to speak';
    } else {
      label.textContent = 'Error. Try again.';
      console.error(result.error);
    }
  }
});
