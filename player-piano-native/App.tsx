import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet, Text, Platform, Image, AppState } from 'react-native';
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
  const stopAll = useStore((state) => state.stopAll);
  const isLocalPlaying = useStore(state => state.localPlayback.isPlaying);
  const isPianoPlaying = useStore(state => state.pianoPlayback.isPlaying);
  const themeColors = Colors[theme];
  
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
          s = { isPlaying: true, file: ps.file, elapsed: ps.elapsed, length: ps.length, type: 'single' };
        } else {
          s = { isPlaying: false, file: null, elapsed: 0, length: 0, type: null };
        }
      } else {
        s = { isPlaying: true, file: s.file, elapsed: s.elapsed, length: s.length, type: 'queue' };
      }
      setPianoPlayback(s);
    } catch (e) {}
  }, [setPianoPlayback]);

  // Start/stop polling based on app visibility and login state
  React.useEffect(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }

    if (isLoggedIn && appStateVisible === 'active') {
      fetchPianoStatus();
      pollTimer.current = setInterval(fetchPianoStatus, 2000);
    }

    return () => {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    };
  }, [isLoggedIn, appStateVisible, fetchPianoStatus]);

  const showRemote = React.useCallback(async () => {
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
        
        // Setup Notifications
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

        // Artificial delay for the "Full Splash Experience"
        await new Promise(resolve => setTimeout(resolve, 800));
      } catch (e) {
        console.warn('Initialization Error:', e);
      } finally {
        setAppIsReady(true);
      }
    }

    prepare();

    const subscription = Notifications.addNotificationResponseReceivedListener(async (response) => {
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

    return () => {
      subscription.remove();
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

  const onLayoutRootView = React.useCallback(async () => {
    if (appIsReady) {
      // Hide the native splash immediately
      await SplashScreen.hideAsync().catch(() => {});
      // Fade out the manual splash
      setTimeout(() => setShowManualSplash(false), 400);
    }
  }, [appIsReady]);

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
