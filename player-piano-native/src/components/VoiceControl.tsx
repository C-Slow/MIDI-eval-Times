import React, { useState, useEffect } from 'react';
import { View, TouchableOpacity, StyleSheet, ActivityIndicator, Animated, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Audio } from 'expo-av';
import * as Speech from 'expo-speech';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '../store/useStore';
import { voiceApi } from '../services/api';
import { Colors } from '../constants/Colors';
import { setAudioMode } from '../services/audioMode';
import { useAudioPlayer } from '../hooks/useAudioPlayer';

export const VoiceControl = () => {
  const theme = useStore(state => state.theme);
  const isLocalPlaying = useStore(state => state.localPlayback.isPlaying);
  const isLocalLoading = useStore(state => state.localPlayback.isLoading);
  const isPianoPlaying = useStore(state => state.pianoPlayback.isPlaying);
  const setSystemBusy = useStore(state => state.setSystemBusy);
  const { pause: pauseLocal } = useAudioPlayer();
  const insets = useSafeAreaInsets();
  const themeColors = Colors[theme];
  
  const isPlayerVisible = isLocalPlaying || isLocalLoading || isPianoPlaying;
  const bottomOffset = isPlayerVisible ? (insets.bottom + 175) : (insets.bottom + 90);

  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const pulseAnim = useState(new Animated.Value(1))[0];

  useEffect(() => {
    if (recording) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.2, duration: 500, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 500, useNativeDriver: true })
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [recording]);

  async function startRecording() {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Microphone access is required for voice control.');
        return;
      }

      // 1. Mark system as busy to prevent other audio triggers
      setSystemBusy(true);

      // 2. Duck local audio if playing
      if (isLocalPlaying) {
        await pauseLocal();
      }

      // 3. Switch to recording mode
      await setAudioMode('recording');

      // Android often prefers explicit options over presets for some devices
      const recordingOptions = {
        android: {
          extension: '.m4a',
          outputFormat: Audio.AndroidOutputFormat.MPEG_4,
          audioEncoder: Audio.AndroidAudioEncoder.AAC,
          sampleRate: 44100,
          numberOfChannels: 2,
          bitRate: 128000,
        },
        ios: {
          extension: '.m4a',
          outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
          audioQuality: Audio.IOSAudioQuality.HIGH,
          sampleRate: 44100,
          numberOfChannels: 2,
          bitRate: 128000,
          linearPCMBitDepth: 16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat: false,
        },
        web: {},
      };

      const { recording } = await Audio.Recording.createAsync(recordingOptions);
      setRecording(recording);
    } catch (err: any) {
      console.error('Failed to start recording', err);
      Alert.alert('Recording Error', err.message || 'Could not start recording.');
      setSystemBusy(false);
      setAudioMode('playback');
    }
  }

  async function stopRecording() {
    if (!recording) return;
    setRecording(null);
    try {
      await recording.stopAndUnloadAsync();
      
      // Immediately restore playback audio mode to prevent background suspension
      await setAudioMode('playback');

      const uri = recording.getURI();
      if (uri) {
        processVoice(uri);
      } else {
        setSystemBusy(false);
      }
    } catch (err: any) {
      console.error('Failed to stop recording', err);
      Alert.alert('Recording Error', 'Failed to save audio command.');
      setSystemBusy(false);
      setAudioMode('playback');
    }
  }

  async function processVoice(uri: string) {
    setIsProcessing(true);
    try {
      const result = await voiceApi.sendAudio(uri);
      if (result.response_text) {
        Speech.speak(result.response_text, {
          language: 'en',
          pitch: 1.0,
          rate: 1.0
        });
      }
    } catch (err: any) {
      console.error('Voice processing failed', err);
      Alert.alert('AI Error', 'Could not process voice command. Check backend logs.');
    } finally {
      setIsProcessing(false);
      setSystemBusy(false);
    }
  }

  return (
    <View style={[styles.container, { bottom: bottomOffset }]}>
      <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
        <TouchableOpacity
          onPressIn={startRecording}
          onPressOut={stopRecording}
          disabled={isProcessing}
          style={[
            styles.micBtn, 
            { backgroundColor: recording ? '#ff5252' : themeColors.accent },
            isProcessing && { opacity: 0.5 }
          ]}
        >
          {isProcessing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Ionicons name={recording ? "mic" : "mic-outline"} size={28} color="#fff" />
          )}
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: 20,
    zIndex: 999
  },
  micBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4
  }
});
