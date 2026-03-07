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

  const start = useCallback(async () => {
    const { granted } =
      await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!granted) return;
    ExpoSpeechRecognitionModule.start({ lang, interimResults: true });
    setIsListening(true);
  }, [lang]);

  const stop = useCallback(() => {
    ExpoSpeechRecognitionModule.stop();
    setIsListening(false);
  }, []);

  useSpeechRecognitionEvent("result", (event) => {
    const transcript = event.results[0]?.transcript;
    if (transcript) onTranscriptRef.current(transcript);
  });

  useSpeechRecognitionEvent("end", () => setIsListening(false));

  return { isListening, start, stop };
}
