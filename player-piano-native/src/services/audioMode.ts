import { Audio } from 'expo-av';

export const AudioModes = {
  Playback: {
    allowsRecordingIOS: false,
    staysActiveInBackground: true,
    interruptionModeIOS: 1, // DoNotMix
    playsInSilentModeIOS: true,
    shouldDuckAndroid: true,
    interruptionModeAndroid: 1, // DoNotMix
    playThroughEarpieceAndroid: false,
  },
  Recording: {
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
    shouldDuckAndroid: true,
    playThroughEarpieceAndroid: false,
    staysActiveInBackground: true,
  }
};

export const setAudioMode = async (mode: 'playback' | 'recording') => {
  try {
    await Audio.setAudioModeAsync(mode === 'playback' ? AudioModes.Playback : AudioModes.Recording);
  } catch (error) {
    console.error(`Failed to set audio mode: ${mode}`, error);
  }
};
