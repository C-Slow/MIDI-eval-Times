import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { useStore } from '../store/useStore';
import { authApi } from '../services/api';
import { Colors } from '../constants/Colors';

export const LoginScreen = () => {
  const { serverUrl, setServerUrl, setToken, setLoggedIn, theme } = useStore();
  const themeColors = Colors[theme];
  const [password, setPassword] = useState('');
  const [tempUrl, setTempUrl] = useState(serverUrl);

  const handleLogin = async () => {
    const cleanedUrl = tempUrl.trim().replace(/\/+$/, ''); // Trim spaces and remove trailing slashes
    
    if (!cleanedUrl.startsWith('http')) {
      Alert.alert('Invalid URL', 'Please include http:// or https://');
      return;
    }

    try {
      console.log(`Attempting login to: ${cleanedUrl}/login`);
      setServerUrl(cleanedUrl);
      
      await new Promise(resolve => setTimeout(resolve, 100));

      const data = await authApi.login(password);
      setToken(data.token);
      setLoggedIn(true);
    } catch (error: any) {
      console.error('Login Error:', error);
      const detail = error.response?.data?.detail;
      const status = error.response?.status;
      const message = error.message;
      
      Alert.alert(
        'Login Failed', 
        `Status: ${status || 'No Response'}\nMessage: ${message}\nDetail: ${detail || 'None'}\n\nURL: ${cleanedUrl}`
      );
    }
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[styles.container, { backgroundColor: themeColors.background }]}
    >
      <View style={styles.inner}>
        <Text style={[styles.title, { color: themeColors.accent }]}>Player Piano</Text>
        <Text style={[styles.subtitle, { color: themeColors.textMuted }]}>Native Edition</Text>
        
        <View style={styles.inputGroup}>
          <Text style={[styles.label, { color: themeColors.textMuted }]}>Server URL</Text>
          <TextInput
            style={[styles.input, { borderColor: themeColors.border, backgroundColor: themeColors.surface, color: themeColors.text }]}
            value={tempUrl}
            onChangeText={setTempUrl}
            placeholder="http://192.168.1.xxx:8000"
            placeholderTextColor={themeColors.textMuted}
            autoCapitalize="none"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={[styles.label, { color: themeColors.textMuted }]}>Master Password</Text>
          <TextInput
            style={[styles.input, { borderColor: themeColors.border, backgroundColor: themeColors.surface, color: themeColors.text }]}
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor={themeColors.textMuted}
            secureTextEntry
          />
        </View>

        <TouchableOpacity style={[styles.button, { backgroundColor: themeColors.accent }]} onPress={handleLogin}>
          <Text style={styles.buttonText}>Login</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { flex: 1, justifyContent: 'center', padding: 30 },
  title: { fontSize: 32, fontWeight: '700', textAlign: 'center' },
  subtitle: { fontSize: 14, textAlign: 'center', marginBottom: 40, letterSpacing: 2, textTransform: 'uppercase' },
  inputGroup: { marginBottom: 20 },
  label: { fontSize: 12, marginBottom: 8, fontWeight: '600' },
  input: { borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 16 },
  button: { padding: 15, borderRadius: 8, marginTop: 20 },
  buttonText: { color: '#fff', textAlign: 'center', fontSize: 16, fontWeight: '600' },
});
