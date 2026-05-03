import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet, Text, Platform } from 'react-native';
import * as NavigationBar from 'expo-navigation-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from './src/store/useStore';
import { LoginScreen } from './src/screens/LoginScreen';
import { FilesScreen } from './src/screens/FilesScreen';
import { PlaylistsScreen } from './src/screens/PlaylistsScreen';
import { UploadScreen } from './src/screens/UploadScreen';
import { Mp3OrchestrateScreen } from './src/screens/Mp3OrchestrateScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { GlobalPlayer } from './src/components/GlobalPlayer';
import { VoiceControl } from './src/components/VoiceControl';
import { Colors } from './src/constants/Colors';
import * as Notifications from 'expo-notifications';

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

function MainTabs() {
  const insets = useSafeAreaInsets();
  const theme = useStore((state) => state.theme);
  const setCurrentTab = useStore((state) => state.setCurrentTab);
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
        }
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
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

const REMOTE_ID = 'yamaha-remote-control';

export default function App() {
  const isLoggedIn = useStore((state) => state.isLoggedIn);
  const theme = useStore((state) => state.theme);
  const initialize = useStore((state) => state.initialize);
  const setPianoPlayback = useStore((state) => state.setPianoPlayback);
  const themeColors = Colors[theme];

  const pollTimer = React.useRef<any>(null);

  const fetchPianoStatus = async () => {
    const { pianoApi } = require('./src/services/api');
    try {
      let s = await pianoApi.getQueueStatus();
      if (!s.playing) {
        const ps = await pianoApi.getPlaybackStatus();
        if (ps.playing) {
          s = { isPlaying: true, file: ps.file, elapsed: ps.elapsed, length: ps.length, type: 'single' };
        } else {
          s = { isPlaying: false, file: null, elapsed: 0, length: 0, type: null };
        }
      } else {
        s = { isPlaying: true, file: s.file, elapsed: s.elapsed, length: s.length, type: 'queue' };
      }
      setPianoPlayback(s);
    } catch (e) {}
  };

  const showRemote = async () => {
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
  };

  // Watch for playback starts to restore notification if dismissed
  const isLocalPlaying = useStore(state => state.localPlayback.isPlaying);
  const isPianoPlaying = useStore(state => state.pianoPlayback.isPlaying);

  React.useEffect(() => {
    if (isLocalPlaying || isPianoPlaying) {
      showRemote();
    }
  }, [isLocalPlaying, isPianoPlaying]);

  React.useEffect(() => {
    initialize();
    
    fetchPianoStatus();
    pollTimer.current = setInterval(fetchPianoStatus, 2000);

    // Request permissions
    async function requestPermissions() {
      const { status } = await Notifications.getPermissionsAsync();
      if (status !== 'granted') {
        await Notifications.requestPermissionsAsync();
      }
      if (isLoggedIn) showRemote();
    }
    requestPermissions();

    // Define the buttons for our notification
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

    // Listen for button taps
    const subscription = Notifications.addNotificationResponseReceivedListener(async (response) => {
      const action = response.actionIdentifier;
      const state = useStore.getState();
      const { pianoApi } = require('./src/services/api');
      
      try {
        if (action === 'skip') {
          await pianoApi.next();
        } else if (action === 'stop') {
          await pianoApi.stop();
          state.stopAll();
        }
      } catch (e) {
        console.error("Notification action failed", e);
      }
    });

    return () => {
      subscription.remove();
      clearInterval(pollTimer.current);
    };
  }, [isLoggedIn]);

  // Sync Android Navigation Bar color
  React.useEffect(() => {
    if (Platform.OS === 'android') {
      NavigationBar.setBackgroundColorAsync(themeColors.background);
      NavigationBar.setButtonStyleAsync(theme === 'dark' ? 'light' : 'dark');
    }
  }, [theme, themeColors]);

  return (
    <SafeAreaProvider>
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
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
