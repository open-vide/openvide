import { useCallback, useRef, useState } from "react";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "@jamsch/expo-speech-recognition";

/**
 * Voice-to-text hook. Calls `onTranscript` with the full recognized text
 * so far (replaces, not appends) on each interim/final result.
 * When recognition ends, the last transcript stays in place.
 */
export function useVoiceInput(
  onTranscript: (text: string) => void,
  lang: string = "en-US",
) {
  const [isListening, setIsListening] = useState(false);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  const stoppedRef = useRef(false);

  const start = useCallback(async () => {
    const { granted } =
      await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!granted) return;
    stoppedRef.current = false;
    ExpoSpeechRecognitionModule.start({ lang, interimResults: true });
    setIsListening(true);
  }, [lang]);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    ExpoSpeechRecognitionModule.stop();
    setIsListening(false);
  }, []);

  useSpeechRecognitionEvent("result", (event) => {
    if (stoppedRef.current) return;
    const transcript = event.results[0]?.transcript;
    if (transcript) onTranscriptRef.current(transcript);
  });

  useSpeechRecognitionEvent("end", () => {
    stoppedRef.current = false;
    setIsListening(false);
  });

  return { isListening, start, stop };
}
