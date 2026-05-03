import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useFocusEffect } from '@react-navigation/native';
import { useStore } from '../store/useStore';
import api from '../services/api';
import { Colors } from '../constants/Colors';

export const UploadScreen = () => {
  const { theme, serverUrl, token, setUploading: setGlobalUploading, setPollingMuted } = useStore();
  const themeColors = Colors[theme];
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  // Mute polling ONLY when this tab is focused
  useFocusEffect(
    useCallback(() => {
      setPollingMuted(true);
      return () => setPollingMuted(false);
    }, [setPollingMuted])
  );

  const handlePickAndUpload = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['audio/midi', 'audio/x-midi', '*/*'],
        copyToCacheDirectory: true,
        multiple: true
      });

      if (result.canceled) return;

      const totalFiles = result.assets.length;
      setProgress({ current: 0, total: totalFiles });
      setUploading(true);
      setGlobalUploading(true);
      
      for (let i = 0; i < totalFiles; i++) {
        const file = result.assets[i];
        setProgress(p => ({ ...p, current: i + 1 }));
        console.log(`[Upload] (${i+1}/${totalFiles}) Processing: ${file.name}`);

        // Read file as Base64 to ensure maximum reliability on Android
        const base64Data = await FileSystem.readAsStringAsync(file.uri, {
          encoding: 'base64',
        });

        // Use standard JSON POST which is much more stable than Multipart on Android
        const response = await fetch(`${serverUrl}/upload_base64`, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            filename: file.name || 'upload.mid',
            data: base64Data,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Server error on "${file.name}" (${response.status}): ${errorText}`);
        }
      }

      console.log(`[Upload] Success!`);
      Alert.alert('Success', `Successfully uploaded ${totalFiles} files.`);
    } catch (error: any) {
      console.error('[Upload] Error:', error);
      Alert.alert('Upload Failed', error.message || 'An unexpected error occurred');
    } finally {
      setUploading(false);
      setGlobalUploading(false);
      setProgress({ current: 0, total: 0 });
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      <View style={styles.content}>
        <View style={[styles.iconContainer, { backgroundColor: themeColors.surface }]}>
          <Text style={styles.mainIcon}>📤</Text>
        </View>
        <Text style={[styles.title, { color: themeColors.text }]}>Add MIDI Files</Text>
        <Text style={[styles.description, { color: themeColors.textMuted }]}>
          Select one or more MIDI files from your device to upload them to the piano server.
        </Text>

        <TouchableOpacity 
          style={[styles.uploadBtn, { backgroundColor: themeColors.accent }, uploading && styles.disabledBtn]} 
          onPress={handlePickAndUpload}
          disabled={uploading}
        >
          {uploading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.uploadBtnText}>Select Files</Text>
          )}
        </TouchableOpacity>

        {uploading && (
          <Text style={[styles.statusText, { color: themeColors.accent }]}>
            Uploading {progress.current} of {progress.total}...
          </Text>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center' },
  content: { padding: 40, alignItems: 'center' },
  iconContainer: {
    width: 100, height: 100, borderRadius: 50,
    justifyContent: 'center', alignItems: 'center', marginBottom: 20
  },
  mainIcon: { fontSize: 40 },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 10 },
  description: { fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 40 },
  uploadBtn: {
    paddingHorizontal: 40, paddingVertical: 15, borderRadius: 30, width: '100%', alignItems: 'center',
    elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4
  },
  disabledBtn: { backgroundColor: '#ccc' },
  uploadBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  statusText: { marginTop: 20, fontWeight: '500' }
});
