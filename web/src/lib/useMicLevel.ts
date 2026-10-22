import { useEffect, useState } from "react";

/**
 * The student's own microphone level (0..1), measured locally for the speaking indicator.
 * Opens a second, local-only reading of the mic while a call is active (permission is already
 * granted by then); nothing from it is sent anywhere. Echo cancellation keeps the tutor's voice
 * from counting as the student's.
 */
export function useMicLevel(active: boolean): number {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!active) {
      setLevel(0);
      return;
    }
    let stopped = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        if (stopped) return;
        ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        const data = new Float32Array(analyser.fftSize);
        let smooth = 0;
        timer = setInterval(() => {
          analyser.getFloatTimeDomainData(data);
          let sum = 0;
          for (const v of data) sum += v * v;
          const rms = Math.sqrt(sum / data.length);
          // Map speech (~0.01-0.15 RMS) to 0..1 and smooth it so the indicator doesn't flicker.
          const target = Math.min(1, Math.max(0, (rms - 0.008) * 9));
          smooth = smooth * 0.6 + target * 0.4;
          setLevel(Number(smooth.toFixed(3)));
        }, 80);
      } catch {
        // No mic access for the meter: the indicator just won't show the student's level.
      }
    })();

    return () => {
      stopped = true;
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close();
    };
  }, [active]);

  return level;
}
