import { supabase } from './supabase';

export const transcribeRecording = async (audioBlob, signedUrl) => {
  const url = process.env.EXPO_PUBLIC_TRANSCRIBE_URL || '';
  if (!url) return null;

  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    const token = session?.access_token;

    if (signedUrl) {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ signedUrl }),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`Transcription function error ${res.status}: ${txt}`);
      }

      const data = await res.json();
      return data?.transcript || null;
    }

    if (!audioBlob) {
      return null;
    }

    const form = new FormData();
    form.append('file', audioBlob, 'recording.webm');

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: form,
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Transcription function error ${res.status}: ${txt}`);
    }

    const data = await res.json();
    return data?.transcript || null;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('transcribeRecording client error', err);
    throw err;
  }
};

export default { transcribeRecording };
