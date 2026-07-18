import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet, Text, Platform, Image, AppState, Switch, ActivityIndicator, TouchableOpacity, Modal, ScrollView, Alert } from 'react-native';
import * as NavigationBar from 'expo-navigation-bar';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

// Keep the splash screen visible while we fetch resources
SplashScreen.preventAutoHideAsync().catch(() => {});

import { Ionicons } from '@expo/vector-icons';
import { useStore } from './src/store/useStore';
import { LoginScreen } from './src/screens/LoginScreen';
import { FilesScreen } from './src/screens/FilesScreen';
import { PlaylistsScreen } from './src/screens/PlaylistsScreen';
import { UploadScreen } from './src/screens/UploadScreen';
import { Mp3OrchestrateScreen } from './src/screens/Mp3OrchestrateScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { MidiEditorScreen } from './src/screens/MidiEditorScreen';
import { GlobalPlayer } from './src/components/GlobalPlayer';
import { VoiceControl } from './src/components/VoiceControl';
import { Colors } from './src/constants/Colors';
import * as Notifications from 'expo-notifications';
import { useBackingAudioSync } from './src/hooks/useBackingAudioSync';
import Slider from '@react-native-community/slider';
import { midiOrchestratorApi } from './src/services/api';

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

const HeaderControls = () => {
  const theme = useStore((state) => state.theme);
  const backendAudioEnabled = useStore((state) => state.backendAudioEnabled);
  const setBackendAudioEnabled = useStore((state) => state.setBackendAudioEnabled);
  const backendAudioVolume = useStore((state) => state.backendAudioVolume);
  const setBackendAudioVolume = useStore((state) => state.setBackendAudioVolume);
  const selectedDevice = useStore((state) => state.selectedDevice);
  const setSelectedDevice = useStore((state) => state.setSelectedDevice);
  const themeColors = Colors[theme];

  const [connecting, setConnecting] = React.useState(false);
  const [showPicker, setShowPicker] = React.useState(false);
  const [devices, setDevices] = React.useState<any[]>([]);
  const [loadingDevices, setLoadingDevices] = React.useState(false);

  const handleVolumeChange = async (vol: number) => {
    setBackendAudioVolume(vol);
    try {
      await midiOrchestratorApi.setVolume(vol);
    } catch (err) {
      console.error('Failed to set volume', err);
    }
  };

  const handleToggleBackendAudio = async (value: boolean) => {
    setBackendAudioEnabled(value);
    setConnecting(true);
    try {
      await midiOrchestratorApi.saveAudioSettings(value, selectedDevice, backendAudioVolume);
      if (value && selectedDevice) {
        await midiOrchestratorApi.connectBluetoothDevice(selectedDevice);
      } else if (!value) {
        await midiOrchestratorApi.disconnectBluetoothDevice();
      }
    } catch (e: any) {
      console.error('Failed to update audio settings', e);
      Alert.alert('Error', `Failed to apply settings: ${e.message}`);
    } finally {
      setConnecting(false);
    }
  };

  const openDevicePicker = async () => {
    setShowPicker(true);
    setLoadingDevices(true);
    try {
      const data = await midiOrchestratorApi.getAudioDevices();
      setDevices(data.devices || []);
    } catch (err) {
      console.error('Failed to load audio devices', err);
    } finally {
      setLoadingDevices(false);
    }
  };

  const handleSelectDevice = async (device: string) => {
    setSelectedDevice(device);
    setShowPicker(false);
    setConnecting(true);
    try {
      await midiOrchestratorApi.saveAudioSettings(backendAudioEnabled, device, backendAudioVolume);
      if (backendAudioEnabled) {
        await midiOrchestratorApi.connectBluetoothDevice(device);
      }
    } catch (err: any) {
      console.error('Failed to connect to device', err);
      Alert.alert('Connection Error', `Failed to connect: ${err.message}`);
    } finally {
      setConnecting(false);
    }
  };

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 15, gap: 10 }}>
      {/* Speaker / Device Name Link (Only if enabled) */}
      {backendAudioEnabled && (
        <TouchableOpacity 
          onPress={openDevicePicker} 
          style={{ 
            backgroundColor: themeColors.border, 
            paddingHorizontal: 8, 
            paddingVertical: 4, 
            borderRadius: 6,
            maxWidth: 110
          }}
        >
          <Text 
            numberOfLines={1} 
            style={{ 
              fontSize: 10, 
              color: selectedDevice ? themeColors.text : themeColors.textMuted,
              fontWeight: '600'
            }}
          >
            {selectedDevice || 'Select Speaker...'}
          </Text>
        </TouchableOpacity>
      )}

      {/* Backend Audio Toggle */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Ionicons 
          name={backendAudioEnabled ? "volume-high" : "volume-mute"} 
          size={18} 
          color={backendAudioEnabled ? themeColors.accent : themeColors.textMuted} 
        />
        {connecting ? (
          <ActivityIndicator size="small" color={themeColors.accent} style={{ width: 40 }} />
        ) : (
          <Switch
            value={backendAudioEnabled}
            onValueChange={handleToggleBackendAudio}
            trackColor={{ false: themeColors.border, true: themeColors.accent }}
            thumbColor={Platform.OS === 'android' ? '#fff' : undefined}
            style={Platform.OS === 'ios' ? { transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] } : undefined}
          />
        )}
      </View>

      {/* Volume Slider (Only shown if enabled) */}
      {backendAudioEnabled && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <Slider
            style={{ width: 80, height: 40 }}
            minimumValue={0}
            maximumValue={1}
            minimumTrackTintColor={themeColors.accent}
            maximumTrackTintColor={themeColors.textMuted}
            thumbTintColor={themeColors.accent}
            value={backendAudioVolume}
            onValueChange={handleVolumeChange}
          />
        </View>
      )}

      {/* Device Picker Modal */}
      <Modal
        visible={showPicker}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowPicker(false)}
      >
        <TouchableOpacity 
          activeOpacity={1} 
          onPress={() => setShowPicker(false)}
          style={{ 
            flex: 1, 
            backgroundColor: 'rgba(0,0,0,0.5)', 
            justifyContent: 'center', 
            alignItems: 'center' 
          }}
        >
          <View 
            style={{ 
              width: '80%', 
              backgroundColor: themeColors.background, 
              borderRadius: 12, 
              padding: 16,
              maxHeight: '60%',
              borderWidth: 1,
              borderColor: themeColors.border
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: 'bold', color: themeColors.text, marginBottom: 12 }}>
              Select Bluetooth Speaker
            </Text>

            {loadingDevices ? (
              <ActivityIndicator size="large" color={themeColors.accent} style={{ marginVertical: 20 }} />
            ) : devices.length === 0 ? (
              <Text style={{ color: themeColors.textMuted, fontSize: 12, fontStyle: 'italic', marginVertical: 20, textAlign: 'center' }}>
                No paired Bluetooth devices found. Make sure it is paired in Windows settings.
              </Text>
            ) : (
              <ScrollView style={{ marginVertical: 8 }}>
                {devices.map((device) => {
                  const isSelected = selectedDevice === device.name;
                  return (
                    <TouchableOpacity
                      key={device.name}
                      onPress={() => handleSelectDevice(device.name)}
                      style={{
                        paddingVertical: 12,
                        paddingHorizontal: 10,
                        borderBottomWidth: 1,
                        borderBottomColor: themeColors.border,
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}
                    >
                      <Text style={{ 
                        fontSize: 14, 
                        color: themeColors.text,
                        fontWeight: isSelected ? 'bold' : 'normal' 
                      }}>
                        {device.name}
                      </Text>
                      {isSelected && (
                        <Ionicons name="checkmark" size={18} color={themeColors.accent} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}

            <TouchableOpacity 
              onPress={() => setShowPicker(false)}
              style={{ 
                marginTop: 16, 
                backgroundColor: themeColors.accent, 
                paddingVertical: 10, 
                borderRadius: 8,
                alignItems: 'center' 
              }}
            >
              <Text style={{ color: '#fff', fontWeight: 'bold' }}>Close</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

function MainTabs() {
  const insets = useSafeAreaInsets();
  const theme = useStore((state) => state.theme);
  const setCurrentTab = useStore((state) => state.setCurrentTab);
  const backendAudioEnabled = useStore((state) => state.backendAudioEnabled);
  const themeColors = Colors[theme];
  
  return (
    <Tab.Navigator 
      screenOptions={{ 
        headerStyle: { 
          backgroundColor: themeColors.background,
          elevation: 0, shadowOpacity: 0, borderBottomWidth: 1, borderBottomColor: themeColors.border 
        },
        headerTintColor: themeColors.text,
        tabBarActiveTintColor: themeColors.accent,
        tabBarInactiveTintColor: themeColors.textMuted,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600', marginBottom: 0 },
        tabBarStyle: { 
          height: 55 + insets.bottom,
          paddingBottom: insets.bottom + 8,
          paddingTop: 8,
          backgroundColor: themeColors.background,
          borderTopWidth: 1,
          borderTopColor: themeColors.border
        },
        headerRight: () => <HeaderControls />
      }}
      screenListeners={{
        state: (e) => {
          const route = e.data.state.routes[e.data.state.index];
          setCurrentTab(route.name);
        },
      }}
    >
      <Tab.Screen 
        name="FilesTab" 
        component={FilesScreen} 
        options={{ 
          title: 'Files',
          tabBarLabel: 'Files',
          tabBarIcon: ({ color, size }) => <Ionicons name="folder-open-outline" size={size} color={color} />
        }} 
      />
      <Tab.Screen 
        name="PlaylistsTab" 
        component={PlaylistsScreen} 
        options={{ 
          title: 'Playlists',
          tabBarLabel: 'Playlists',
          tabBarIcon: ({ color, size }) => <Ionicons name="musical-notes-outline" size={size} color={color} />
        }} 
      />
      <Tab.Screen 
        name="UploadTab" 
        component={UploadScreen} 
        options={{ 
          title: 'Upload',
          tabBarLabel: 'Upload',
          tabBarIcon: ({ color, size }) => <Ionicons name="cloud-upload-outline" size={size} color={color} />
        }} 
      />
      <Tab.Screen 
        name="OrchestratorTab" 
        component={Mp3OrchestrateScreen} 
        options={{ 
          title: 'Orchestra',
          tabBarLabel: 'Orchestra',
          tabBarIcon: ({ color, size }) => <Ionicons name="musical-note-outline" size={size} color={color} />
        }} 
      />
      <Tab.Screen 
        name="MidiEditorTab" 
        component={MidiEditorScreen} 
        options={{ 
          title: 'MIDI Editor',
          tabBarLabel: 'MIDI Editor',
          tabBarIcon: ({ color, size }) => <Ionicons name="create-outline" size={size} color={color} />
        }} 
      />
      <Tab.Screen 
        name="SettingsTab" 
        component={SettingsScreen} 
        options={{ 
          title: 'Settings',
          tabBarLabel: 'Settings',
          tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" size={size} color={color} />
        }} 
      />
    </Tab.Navigator>
  );
}

// Configure how notifications behave
if (Platform.OS !== 'web') {
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
  } catch (e) {
    console.warn('Failed to set notification handler:', e);
  }
}

const REMOTE_ID = 'yamaha-remote-control';

export default function App() {
  const isLoggedIn = useStore((state) => state.isLoggedIn);
  const theme = useStore((state) => state.theme);
  const initialize = useStore((state) => state.initialize);
  const setPianoPlayback = useStore((state) => state.setPianoPlayback);
  const stopAll = useStore((state) => state.stopAll);
  const isLocalPlaying = useStore(state => state.localPlayback.isPlaying);
  const isPianoPlaying = useStore(state => state.pianoPlayback.isPlaying);
  const themeColors = Colors[theme];
  
  // Call backing audio sync hook
  useBackingAudioSync();
  
  const [appIsReady, setAppIsReady] = React.useState(false);
  const [showManualSplash, setShowManualSplash] = React.useState(true);

  const pollTimer = React.useRef<any>(null);
  const [appStateVisible, setAppStateVisible] = React.useState(AppState.currentState);

  // AppState Listener
  React.useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      setAppStateVisible(nextAppState);
    });
    return () => {
      subscription.remove();
    };
  }, []);

  const fetchPianoStatus = React.useCallback(async () => {
    try {
      const { pianoApi } = require('./src/services/api');
      let s = await pianoApi.getQueueStatus();
      if (!s.playing) {
        const ps = await pianoApi.getPlaybackStatus();
        if (ps.playing) {
          s = { isPlaying: true, file: ps.file, elapsed: ps.elapsed, length: ps.length, type: 'single', backend_audio_enabled: ps.backend_audio_enabled };
        } else {
          s = { isPlaying: false, file: null, elapsed: 0, length: 0, type: null, backend_audio_enabled: false };
        }
      } else {
        s = { isPlaying: true, file: s.file, elapsed: s.elapsed, length: s.length, type: 'queue', backend_audio_enabled: s.backend_audio_enabled };
      }
      setPianoPlayback(s);
    } catch (e) {}
  }, [setPianoPlayback]);

  // Start/stop polling based on app visibility and login state
  React.useEffect(() => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }

    let active = true;

    const runPoll = async () => {
      if (!active) return;
      await fetchPianoStatus();
      if (active) {
        pollTimer.current = setTimeout(runPoll, 2000);
      }
    };

    if (isLoggedIn && appStateVisible === 'active') {
      runPoll();
    }

    return () => {
      active = false;
      if (pollTimer.current) {
        clearTimeout(pollTimer.current);
        pollTimer.current = null;
      }
    };
  }, [isLoggedIn, appStateVisible, fetchPianoStatus]);

  const showRemote = React.useCallback(async () => {
    if (Platform.OS === 'web') return;
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: REMOTE_ID,
        content: {
          title: "Yamaha Remote",
          body: "Controls for Piano and MIDI",
          categoryIdentifier: 'player_controls',
          sticky: true,
        },
        trigger: null,
      });
    } catch (e) {}
  }, []);

  // Main Initialization (Notifications setup)
  React.useEffect(() => {
    async function prepare() {
      try {
        // Initialize store
        initialize();
        
        // Setup Notifications (Only on mobile)
        if (Platform.OS !== 'web') {
          const { status } = await Notifications.getPermissionsAsync();
          if (status !== 'granted') {
            await Notifications.requestPermissionsAsync();
          }

          Notifications.setNotificationCategoryAsync('player_controls', [
            {
              identifier: 'skip',
              buttonTitle: 'Skip Track',
              options: { opensAppToForeground: false },
            },
            {
              identifier: 'stop',
              buttonTitle: 'Stop All',
              options: { opensAppToForeground: false },
            },
          ]);
        }

        // Artificial delay for the "Full Splash Experience"
        await new Promise(resolve => setTimeout(resolve, 800));
      } catch (e) {
        console.warn('Initialization Error:', e);
      } finally {
        setAppIsReady(true);
      }
    }

    prepare();

    let subscription: any;
    if (Platform.OS !== 'web') {
      subscription = Notifications.addNotificationResponseReceivedListener(async (response) => {
        const action = response.actionIdentifier;
        const { pianoApi } = require('./src/services/api');
        try {
          if (action === 'skip') {
            await pianoApi.next();
          } else if (action === 'stop') {
            await pianoApi.stop();
            stopAll();
          }
        } catch (e) {
          console.error("Notification action failed", e);
        }
      });
    }

    return () => {
      if (subscription) {
        subscription.remove();
      }
    };
  }, [initialize, stopAll]);

  // Show remote notification when playing
  React.useEffect(() => {
    if (isLoggedIn && (isLocalPlaying || isPianoPlaying)) {
      showRemote();
    }
  }, [isLoggedIn, isLocalPlaying, isPianoPlaying, showRemote]);

  // Sync Android Navigation Bar color
  React.useEffect(() => {
    if (Platform.OS === 'android') {
      NavigationBar.setBackgroundColorAsync(themeColors.background);
      NavigationBar.setButtonStyleAsync(theme === 'dark' ? 'light' : 'dark');
    }
  }, [theme, themeColors]);

  // Handle splash screen hiding cross-platform via useEffect
  React.useEffect(() => {
    if (appIsReady) {
      SplashScreen.hideAsync().catch(() => {});
      const timer = setTimeout(() => setShowManualSplash(false), 400);
      return () => clearTimeout(timer);
    }
  }, [appIsReady]);

  const onLayoutRootView = React.useCallback(async () => {
    // Keep as a fallback no-op or layout trigger
  }, []);

  if (!appIsReady) {
    // While app is NOT ready, we are still showing the NATIVE splash screen
    // so we return null to keep the screen blank under the native splash
    return null;
  }

  return (
    <SafeAreaProvider onLayout={onLayoutRootView}>
      <NavigationContainer>
        <View style={[styles.container, { backgroundColor: themeColors.background }]}>
          <View style={{ flex: 1 }}>
            <Stack.Navigator screenOptions={{ headerShown: false }}>
              {!isLoggedIn ? (
                <Stack.Screen name="Login" component={LoginScreen} />
              ) : (
                <Stack.Screen name="Main" component={MainTabs} />
              )}
            </Stack.Navigator>
          </View>
          
          {isLoggedIn && <GlobalPlayer />}
          {isLoggedIn && <VoiceControl />}
          <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
        </View>
      </NavigationContainer>

      {showManualSplash && (
        <View style={[StyleSheet.absoluteFill, styles.splashContainer, { backgroundColor: '#121212' }]}>
          <Image 
            source={require('./assets/icon.png')} 
            style={styles.splashImage}
            resizeMode="contain"
          />
        </View>
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  splashContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  splashImage: {
    width: '100%',
    height: '100%',
  },
});
