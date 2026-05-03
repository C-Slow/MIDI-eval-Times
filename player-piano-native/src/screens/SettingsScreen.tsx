import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, FlatList, Alert, Switch, TextInput, Linking, ScrollView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as IntentLauncher from 'expo-intent-launcher';
import { useStore } from '../store/useStore';
import { midiApi, settingsApi, systemApi } from '../services/api';
import { Colors } from '../constants/Colors';

export const SettingsScreen = () => {
  const { isPianoConnected, targetDevice, setPianoStatus, theme, setTheme, logout } = useStore();
  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState<any[]>([]);
  const [geminiKey, setGeminiKey] = useState('');
  const [isSavingKey, setIsSavingKey] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);

  const themeColors = Colors[theme];

  const handleCreateBackup = async () => {
    setIsBackingUp(true);
    try {
      await systemApi.createBackup();
      Alert.alert('Backup Started', 'The server is creating a backup in the background.');
    } catch (error) {
      Alert.alert('Error', 'Failed to trigger backup.');
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Logout', style: 'destructive', onPress: logout }
    ]);
  };

  const checkStatus = async () => {
    try {
      const data = await midiApi.getStatus();
      setPianoStatus(data.connected, data.target_device);
    } catch (e) {}
  };

  const fetchGeminiKey = async () => {
    try {
      const data = await settingsApi.getGeminiKey();
      setGeminiKey(data.key || '');
    } catch (e) {}
  };

  const handleSaveGeminiKey = async () => {
    setIsSavingKey(true);
    try {
      await settingsApi.saveGeminiKey(geminiKey);
      Alert.alert('Success', 'Gemini API key saved.');
    } catch (error) {
      Alert.alert('Error', 'Failed to save Gemini key.');
    } finally {
      setIsSavingKey(false);
    }
  };

  useEffect(() => {
    checkStatus();
    fetchGeminiKey();
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleScan = async () => {
    setScanning(true);
    try {
      const results = await midiApi.scan();
      setDevices(results);
    } catch (error) {
      Alert.alert('Scan Failed', 'Could not scan for Bluetooth devices.');
    } finally {
      setScanning(false);
    }
  };

  const handleConnect = async (name: string) => {
    try {
      await midiApi.connect(name);
      setPianoStatus(false, name);
      Alert.alert('Connecting', `Searching for ${name}...`);
    } catch (error) {
      Alert.alert('Error', 'Failed to update target device.');
    }
  };

  return (
    <ScrollView 
      style={[styles.container, { backgroundColor: themeColors.background }]}
      contentContainerStyle={{ padding: 20, paddingBottom: 60 }}
    >
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: themeColors.textMuted }]}>App Theme</Text>
        <View style={[styles.row, styles.card, { backgroundColor: themeColors.surface, borderColor: themeColors.border }]}>
          <View style={styles.rowInfo}>
            <Ionicons name={theme === 'dark' ? "moon-outline" : "sunny-outline"} size={20} color={themeColors.text} />
            <Text style={[styles.cardTitle, { color: themeColors.text, marginLeft: 10 }]}>Dark Mode</Text>
          </View>
          <Switch 
            value={theme === 'dark'} 
            onValueChange={(v) => setTheme(v ? 'dark' : 'light')} 
            trackColor={{ false: '#ccc', true: themeColors.accent }}
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: themeColors.textMuted }]}>Piano Connection</Text>
        <View style={[styles.statusCard, { backgroundColor: themeColors.surface, borderColor: themeColors.border }]}>
          <View style={[styles.statusDot, { backgroundColor: isPianoConnected ? themeColors.success : themeColors.danger }]} />
          <View>
            <Text style={[styles.statusText, { color: themeColors.text }]}>{isPianoConnected ? 'Connected' : 'Disconnected'}</Text>
            <Text style={[styles.targetText, { color: themeColors.textMuted }]}>Target: {targetDevice}</Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: themeColors.textMuted }]}>Gemini AI Integration</Text>
        <View style={[styles.card, { backgroundColor: themeColors.surface, borderColor: themeColors.border }]}>
          <Text style={{ color: themeColors.text, fontSize: 14, marginBottom: 10 }}>Gemini API Key</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TextInput
              style={{ 
                flex: 1, 
                backgroundColor: themeColors.background, 
                color: themeColors.text, 
                padding: 10, 
                borderRadius: 8,
                borderWidth: 1,
                borderColor: themeColors.border
              }}
              value={geminiKey}
              onChangeText={setGeminiKey}
              placeholder="Enter API Key"
              placeholderTextColor={themeColors.textMuted}
              secureTextEntry
            />
            <TouchableOpacity 
              onPress={handleSaveGeminiKey}
              disabled={isSavingKey}
              style={{ 
                backgroundColor: themeColors.accent, 
                paddingHorizontal: 20, 
                borderRadius: 8, 
                justifyContent: 'center' 
              }}
            >
              {isSavingKey ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '600' }}>Save</Text>}
            </TouchableOpacity>
          </View>
          <Text style={{ color: themeColors.textMuted, fontSize: 11, marginTop: 8 }}>
            Used for automatic metadata generation and cleaning suggestions.
          </Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: themeColors.textMuted }]}>Bluetooth Audio</Text>
        <View style={[styles.card, { backgroundColor: themeColors.surface, borderColor: themeColors.border }]}>
          <Text style={{ color: themeColors.text, fontSize: 14, marginBottom: 10 }}>Connect Speakers</Text>
          <TouchableOpacity 
            onPress={async () => {
              if (Platform.OS === 'android') {
                await IntentLauncher.startActivityAsync('android.settings.BLUETOOTH_SETTINGS');
              } else {
                Linking.openSettings();
              }
            }}
            style={{ 
              backgroundColor: themeColors.border, 
              padding: 12, 
              borderRadius: 8, 
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8
            }}
          >
            <Ionicons name="bluetooth-outline" size={20} color={themeColors.text} />
            <Text style={{ color: themeColors.text, fontWeight: '600' }}>Open Bluetooth Settings</Text>
          </TouchableOpacity>
          <Text style={{ color: themeColors.textMuted, fontSize: 11, marginTop: 8 }}>
            Isolated vocals will play through your connected Bluetooth speakers or headphones.
          </Text>
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: themeColors.textMuted }]}>Bluetooth Devices</Text>
          <TouchableOpacity onPress={handleScan} disabled={scanning}>
            {scanning ? <ActivityIndicator size="small" color={themeColors.accent} /> : <Text style={[styles.scanLink, { color: themeColors.accent }]}>Scan</Text>}
          </TouchableOpacity>
        </View>

        <View style={{ maxHeight: 300 }}>
          {devices.map((item) => (
            <TouchableOpacity 
              key={item.address}
              style={[styles.deviceItem, { borderBottomColor: themeColors.border }]} 
              onPress={() => handleConnect(item.name)}
            >
              <View style={styles.deviceInfo}>
                <Text style={[styles.deviceName, { color: themeColors.text }]}>{item.name}</Text>
                <Text style={[styles.deviceAddress, { color: themeColors.textMuted }]}>{item.address}</Text>
              </View>
              {targetDevice === item.name && <Text style={[styles.activeLabel, { color: themeColors.accent }]}>Active</Text>}
            </TouchableOpacity>
          ))}
          {devices.length === 0 && (
            <Text style={[styles.emptyText, { color: themeColors.textMuted }]}>No devices found. Tap Scan to search.</Text>
          )}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: themeColors.textMuted }]}>Maintenance</Text>
        <TouchableOpacity 
          style={[styles.card, { backgroundColor: themeColors.surface, borderColor: themeColors.border, flexDirection: 'row', alignItems: 'center' }]} 
          onPress={handleCreateBackup}
          disabled={isBackingUp}
        >
          {isBackingUp ? (
            <ActivityIndicator color={themeColors.accent} size="small" />
          ) : (
            <Ionicons name="cloud-upload-outline" size={20} color={themeColors.accent} />
          )}
          <View style={{ marginLeft: 10 }}>
            <Text style={[styles.cardTitle, { color: themeColors.text }]}>Create Backup Now</Text>
            <Text style={{ color: themeColors.textMuted, fontSize: 11 }}>Saves snapshots of library and metadata</Text>
          </View>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: themeColors.textMuted }]}>Account</Text>
        <TouchableOpacity 
          style={[styles.card, { backgroundColor: themeColors.surface, borderColor: themeColors.border, flexDirection: 'row', alignItems: 'center' }]} 
          onPress={handleLogout}
        >
          <Ionicons name="log-out-outline" size={20} color={themeColors.danger} />
          <Text style={[styles.cardTitle, { color: themeColors.danger, marginLeft: 10 }]}>Log Out</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  section: { marginBottom: 25 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  sectionTitle: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowInfo: { flexDirection: 'row', alignItems: 'center' },
  
  card: { padding: 15, borderRadius: 12, borderWidth: 1 },
  cardTitle: { fontSize: 16, fontWeight: '500' },

  statusCard: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    padding: 20, 
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 10
  },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginRight: 15 },
  statusText: { fontSize: 18, fontWeight: '600' },
  targetText: { fontSize: 12, marginTop: 2 },
  
  scanLink: { fontWeight: '600' },
  
  deviceItem: { 
    flexDirection: 'row', 
    padding: 15, 
    borderBottomWidth: 1, 
    alignItems: 'center'
  },
  deviceInfo: { flex: 1 },
  deviceName: { fontSize: 16, fontWeight: '500' },
  deviceAddress: { fontSize: 11, marginTop: 2 },
  activeLabel: { fontSize: 12, fontWeight: '700' },
  
  emptyText: { textAlign: 'center', marginTop: 20, fontSize: 14 }
});
