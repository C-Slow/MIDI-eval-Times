import { useEffect, useRef } from 'react';
import { Audio } from 'expo-av';
import { useStore } from '../store/useStore';
import { setAudioMode } from '../services/audioMode';

export const useBackingAudioSync = () => {
  const pianoPlayback = useStore(state => state.pianoPlayback);
  const serverUrl = useStore(state => state.serverUrl);
  const token = useStore(state => state.token);

  const soundRef = useRef<Audio.Sound | null>(null);
  const currentFileRef = useRef<string | null>(null);
  const isSyncingRef = useRef<boolean>(false);

  useEffect(() => {
    const isHybrid = pianoPlayback.file?.startsWith('hybrid:');
    const shouldPlayLocalBacking = pianoPlayback.isPlaying && isHybrid && !pianoPlayback.backend_audio_enabled;

    if (!shouldPlayLocalBacking) {
      if (soundRef.current) {
        console.log('Stopping and unloading local backing audio...');
        const sound = soundRef.current;
        soundRef.current = null;
        currentFileRef.current = null;
        sound.stopAsync().then(() => sound.unloadAsync()).catch(() => {});
      }
      return;
    }

    const file = pianoPlayback.file!;
    const jobId = file.split(':', 2)[1];

    const playAndSync = async () => {
      if (isSyncingRef.current) return;
      isSyncingRef.current = true;
      try {
        if (currentFileRef.current !== file) {
          if (soundRef.current) {
            console.log('Unloading previous local backing audio...');
            await soundRef.current.stopAsync();
            await soundRef.current.unloadAsync();
            soundRef.current = null;
          }
          currentFileRef.current = file;

          await setAudioMode('playback');
          const audioUrl = `${serverUrl}/midi-orchestrator/backing-audio/${jobId}?token=${encodeURIComponent(token || '')}`;
          console.log('Preloading local backing audio from URL:', audioUrl);

          const { sound } = await Audio.Sound.createAsync(
            { uri: audioUrl },
            { shouldPlay: true, volume: 1.0 },
            (status: any) => {
              if (status.didJustFinish) {
                console.log('Local backing audio finished playing');
              }
            }
          );
          soundRef.current = sound;
        }

        if (soundRef.current) {
          const status = await soundRef.current.getStatusAsync();
          if (status.isLoaded) {
            const pianoElapsedMs = pianoPlayback.elapsed * 1000;
            const diff = Math.abs(status.positionMillis - pianoElapsedMs);

            // Sync if deviation is > 1.2 seconds
            if (diff > 1200) {
              console.log(`Syncing backing audio drift: local is at ${status.positionMillis}ms, piano is at ${pianoElapsedMs}ms. Diff: ${diff}ms`);
              await soundRef.current.setPositionAsync(pianoElapsedMs);
            }

            if (!status.isPlaying && pianoPlayback.isPlaying) {
              await soundRef.current.playAsync();
            } else if (status.isPlaying && !pianoPlayback.isPlaying) {
              await soundRef.current.pauseAsync();
            }
          }
        }
      } catch (err) {
        console.error('Failed to sync backing audio locally:', err);
      } finally {
        isSyncingRef.current = false;
      }
    };

    playAndSync();
  }, [
    pianoPlayback.isPlaying,
    pianoPlayback.file,
    pianoPlayback.elapsed,
    pianoPlayback.backend_audio_enabled,
    serverUrl,
    token
  ]);
};
