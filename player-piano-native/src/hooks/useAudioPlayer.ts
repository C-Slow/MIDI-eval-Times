import { useEffect } from 'react';
import { Audio } from 'expo-av';
import { useStore } from '../store/useStore';
import { setAudioMode } from '../services/audioMode';

let soundInstance: Audio.Sound | null = null;
let isProcessing = false;

export const useAudioPlayer = () => {
  const setLocalPlayback = useStore(state => state.setLocalPlayback);
  const setStopTrigger = useStore(state => state.setStopTrigger);
  const setSystemBusy = useStore(state => state.setSystemBusy);

  useEffect(() => {
    // Register our stop function globally so the Remote Notification can call it
    setStopTrigger(() => stop());
  }, []);

  const onPlaybackStatusUpdate = (status: any) => {
    if (status.isLoaded) {
      const currentPlayback = useStore.getState().localPlayback;
      const posDiff = Math.abs(currentPlayback.position - status.positionMillis);
      
      if (posDiff > 1000 || currentPlayback.isPlaying !== status.isPlaying) {
        setLocalPlayback({
          position: status.positionMillis,
          duration: status.durationMillis || 0,
          isPlaying: status.isPlaying,
        });
      }
      
      if (status.didJustFinish) {
        stop();
      }
    }
  };

  const play = async (filename: string) => {
    if (isProcessing) return;
    const isBusy = useStore.getState().isSystemBusy;
    if (isBusy) {
      console.log('System is busy, skipping playback start');
      return;
    }

    isProcessing = true;
    setSystemBusy(true);

    try {
      setLocalPlayback({ isLoading: true });
      
      const currentPlayback = useStore.getState().localPlayback;
      if (soundInstance && currentPlayback.currentFile === filename) {
        const status = await soundInstance.getStatusAsync();
        if (status.isLoaded && !status.isPlaying) {
          await soundInstance.playAsync();
          return;
        }
      }

      if (soundInstance) {
        await soundInstance.stopAsync();
        await soundInstance.unloadAsync();
      }

      // Ensure we are in playback mode
      await setAudioMode('playback');

      const { serverUrl, token } = useStore.getState();
      const renderUrl = `${serverUrl}/files/render/${encodeURIComponent(filename)}?token=${encodeURIComponent(token || '')}`;

      const { sound: newSound } = await Audio.Sound.createAsync(
        { uri: renderUrl },
        { shouldPlay: true, volume: 1.0, progressUpdateIntervalMillis: 500 },
        onPlaybackStatusUpdate
      );

      soundInstance = newSound;
      setLocalPlayback({ currentFile: filename, isLoading: false, isPlaying: true });
    } catch (error) {
      console.error('Playback failed', error);
      setLocalPlayback({ isLoading: false, isPlaying: false });
    } finally {
      isProcessing = false;
      setSystemBusy(false);
    }
  };

  const pause = async () => {
    if (soundInstance) {
      await soundInstance.pauseAsync();
    }
  };

  const stop = async () => {
    if (soundInstance) {
      try {
        await soundInstance.stopAsync();
        await soundInstance.unloadAsync();
      } catch (e) {}
      soundInstance = null;
    }
    setLocalPlayback({ isPlaying: false, position: 0, currentFile: null });
  };

  const seek = async (millis: number) => {
    if (soundInstance) {
      await soundInstance.setPositionAsync(millis);
    }
  };

  return { play, pause, stop, seek };
};
