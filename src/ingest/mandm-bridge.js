/**
 * M&M Bridge — push pulled transcripts to The Meaningful Message.
 *
 * After TDE successfully fetches a transcript (yt-dlp / watch-page /
 * Groq Whisper), it POSTs the result to M&M's /api/transcripts/inbound
 * endpoint. M&M caches it and uses it instead of trying to pull from
 * YouTube directly (which is unreliable now).
 *
 * Configured via env:
 *   MANDM_INGEST_URL    e.g. https://lifestages-mandm.up.railway.app/api/transcripts/inbound
 *   MANDM_INGEST_TOKEN  shared secret matching INGEST_TOKEN on M&M
 *
 * If either env var is missing, this is a no-op — TDE keeps working
 * standalone.
 */

/**
 * @param {Object} args
 * @param {string} args.videoId   - 11-char YouTube ID
 * @param {string} args.title     - Video title (best effort)
 * @param {Object} args.transcript - The transcript object returned by getTranscript()
 *   Must have: { segments: [{ start, end, text }], source }
 */
async function pushTranscriptToMandM({ videoId, title, transcript }) {
  const url = process.env.MANDM_INGEST_URL;
  const token = process.env.MANDM_INGEST_TOKEN;
  if (!url || !token) return; // not configured — silent no-op
  if (!transcript || !Array.isArray(transcript.segments) || transcript.segments.length === 0) {
    return;
  }

  // Convert TDE's {start, end, text} to M&M's {start, dur, text} shape.
  const chunks = transcript.segments
    .map((s) => {
      const start = Number(s.start) || 0;
      const end = Number(s.end) || start;
      const text = String(s.text || "").trim();
      return text ? { text, start, dur: Math.max(0, end - start) } : null;
    })
    .filter(Boolean);

  if (chunks.length === 0) return;

  const payload = {
    youtube_video_id: videoId,
    video_title: title || null,
    chunks,
    source: transcript.source || null
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`  M&M push failed (${res.status}): ${body.slice(0, 200)}`);
      return;
    }
    console.log(`  → pushed transcript to M&M (${chunks.length} chunks)`);
  } catch (err) {
    console.error(`  M&M push error: ${err.message}`);
  }
}

module.exports = { pushTranscriptToMandM };
