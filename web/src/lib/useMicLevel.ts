import { useEffect, useState } from "react";
import { openMicMeter } from "./callController";

/**
 * The student's own microphone level (0..1), measured locally for the speaking indicator.
 * Opens a second, local-only reading of the mic while a call is active (permission is already
 * granted by then); nothing from it is sent anywhere. Echo cancellation keeps the tutor's voice
 * from counting as the student's. All the lifecycle rules are in openMicMeter.
 */
export function useMicLevel(active: boolean): number {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!active) {
      setLevel(0);
      return;
    }
    return openMicMeter({
      getUserMedia: () => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }),
      createAnalyser: (stream) => {
        const ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const data = new Float32Array(analyser.fftSize);
        return {
          read: () => {
            analyser.getFloatTimeDomainData(data);
            let sum = 0;
            for (const v of data) sum += v * v;
            return Math.sqrt(sum / data.length);
          },
          close: () => void ctx.close(),
        };
      },
      onLevel: setLevel,
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (id) => clearInterval(id),
    });
  }, [active]);

  return level;
}
