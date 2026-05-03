import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import Slider from '@react-native-community/slider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { useStore } from '../store/useStore';
import { Colors } from '../constants/Colors';
import api, { pianoApi, fileApi } from '../services/api';
import { SongDetailsModal } from './SongDetailsModal';

export const GlobalPlayer = () => {
  const { pause: pauseLocal, stop: stopLocal, seek: seekLocal } = useAudioPlayer();
  const insets = useSafeAreaInsets();
  const theme = useStore((state) => state.theme);
  const currentTab = useStore((state) => state.currentTab);
  const localPlayback = useStore((state) => state.localPlayback);
  const pianoPlayback = useStore((state) => state.pianoPlayback);
  const files = useStore((state) => state.files);
  const setFiles = useStore((state) => state.setFiles);
  const setCleanModal = useStore((state) => state.setCleanModal);
  const themeColors = Colors[theme];
  
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekValue, setSeekValue] = useState(0);
  const [activePlayer, setActivePlayer] = useState<'local' | 'piano'>('local');
  const [detailsVisible, setDetailsVisible] = useState(false);

  // Determine which player to show by default based on tab and activity
  useEffect(() => {
    if (localPlayback.isPlaying || localPlayback.isLoading) {
      setActivePlayer('local');
    } else if (pianoPlayback.isPlaying) {
      setActivePlayer('piano');
    } else if (currentTab === 'PlaylistsTab') {
      setActivePlayer('piano');
    } else {
      setActivePlayer('local');
    }
  }, [localPlayback.isPlaying, localPlayback.isLoading, pianoPlayback.isPlaying, currentTab]);

  const isLocalActive = localPlayback.isPlaying || localPlayback.isLoading;
  const isPianoActive = pianoPlayback.isPlaying;
  const showPlayer = isLocalActive || isPianoActive || isSeeking;

  useEffect(() => {
    if (!isSeeking) {
      if (activePlayer === 'local') {
        setSeekValue(localPlayback.position);
      } else {
        setSeekValue(pianoPlayback.elapsed * 1000);
      }
    }
  }, [localPlayback.position, pianoPlayback.elapsed, isSeeking, activePlayer]);

  if (!showPlayer) return null;

  const currentData = activePlayer === 'local' ? {
    file: localPlayback.currentFile,
    duration: localPlayback.duration,
    position: localPlayback.position,
    isPlaying: localPlayback.isPlaying,
    isLoading: localPlayback.isLoading,
    type: 'local'
  } : {
    file: pianoPlayback.file,
    duration: pianoPlayback.length * 1000,
    position: pianoPlayback.elapsed * 1000,
    isPlaying: pianoPlayback.isPlaying,
    isLoading: false,
    type: pianoPlayback.type
  };

  const currentFileMetadata = [...files.processed, ...files.raw].find(f => f.name === currentData.file)?.metadata;
  const rating = currentFileMetadata?.rating || 0;

  const formatTime = (millis: number) => {
    const totalSeconds = Math.floor(millis / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const handleStop = async () => {
    if (activePlayer === 'local') {
      stopLocal();
    } else {
      await pianoApi.stop();
    }
  };

  const handleNext = async () => {
    if (activePlayer === 'piano') {
      await pianoApi.next();
    }
  };

  const handleSlidingComplete = async (value: number) => {
    const seconds = value / 1000;
    setIsSeeking(true);
    
    try {
      if (activePlayer === 'local') {
        await seekLocal(value);
      } else if (isPianoActive) {
        if (pianoPlayback.type === 'queue') {
          await api.post('/queue/seek', { offset: seconds });
        } else {
          const { targetDevice } = useStore.getState();
          await api.post('/play/seek', { 
            filename: pianoPlayback.file, 
            offset: seconds,
            port_name: targetDevice
          });
        }
      }
    } catch (e) {
      console.error('Seek failed', e);
    } finally {
      setTimeout(() => setIsSeeking(false), 200);
    }
  };

  const fetchFiles = async () => {
    try {
      const data = await fileApi.listFiles();
      setFiles(data);
    } catch (error) {
      console.error(error);
    }
  };

  const renderStars = (count: number) => {
    if (count <= 0) return null;
    return (
      <View style={{ flexDirection: 'row', marginLeft: 6 }}>
        {[1, 2, 3, 4, 5].map(i => (
          <Ionicons 
            key={i} 
            name={i <= count ? "star" : "star-outline"} 
            size={10} 
            color={i <= count ? "#FFD700" : themeColors.textMuted} 
          />
        ))}
      </View>
    );
  };

  const bottomPadding = insets.bottom || 5;

  return (
    <View style={[styles.container, { 
      backgroundColor: themeColors.background, 
      borderTopColor: themeColors.border,
      paddingBottom: bottomPadding 
    }]}>
      <Slider
        style={styles.slider}
        minimumValue={0}
        maximumValue={currentData.duration || 1}
        value={seekValue}
        onValueChange={(v) => { setIsSeeking(true); setSeekValue(v); }}
        onSlidingComplete={handleSlidingComplete}
        minimumTrackTintColor={themeColors.accent}
        maximumTrackTintColor={themeColors.border}
        thumbTintColor={themeColors.accent}
      />
      
      <TouchableOpacity 
        style={styles.content}
        onLongPress={() => setDetailsVisible(true)}
        delayLongPress={600}
        activeOpacity={0.8}
      >
        {/* Player Toggle if both are active */}
        {isLocalActive && isPianoActive && (
          <TouchableOpacity 
            style={[styles.toggleBtn, { backgroundColor: themeColors.surfaceSecondary }]} 
            onPress={() => setActivePlayer(activePlayer === 'local' ? 'piano' : 'local')}
          >
            <Ionicons 
              name={activePlayer === 'local' ? "musical-notes" : "phone-portrait-outline"} 
              size={18} 
              color={themeColors.accent} 
            />
          </TouchableOpacity>
        )}

        <View style={styles.info}>
          <View style={styles.titleRow}>
            {activePlayer === 'piano' && <Ionicons name="musical-notes" size={14} color={themeColors.accent} style={{marginRight: 5}} />}
            <Text style={[styles.fileName, { color: themeColors.text }]} numberOfLines={1}>
              {currentData.isLoading ? 'Rendering...' : currentData.file?.replace(/\.midi?$/i, '') || 'Unknown'}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 1 }}>
            <Text style={[styles.time, { color: themeColors.textMuted, marginTop: 0 }]} numberOfLines={1}>
              {activePlayer === 'local' ? 'Phone' : 'Piano'} • {formatTime(isSeeking ? seekValue : currentData.position)} / {formatTime(currentData.duration)}
              {currentFileMetadata?.artist ? ` • ${currentFileMetadata.artist}` : ''}
            </Text>
            {renderStars(rating)}
          </View>
        </View>

        <View style={styles.controls}>
          {currentData.isLoading ? (
            <ActivityIndicator color={themeColors.accent} />
          ) : (
            <>
              {activePlayer === 'local' && currentData.isPlaying && (
                <TouchableOpacity onPress={pauseLocal} style={{ marginRight: 10 }}>
                  <Ionicons name="pause-circle-outline" size={32} color={themeColors.accent} />
                </TouchableOpacity>
              )}
              
              <TouchableOpacity onPress={handleStop}>
                <Ionicons name="stop-circle-outline" size={32} color={themeColors.accent} />
              </TouchableOpacity>

              {activePlayer === 'piano' && currentData.type === 'queue' && (
                <TouchableOpacity onPress={handleNext} style={{ marginLeft: 10 }}>
                  <Ionicons name="play-forward-circle-outline" size={32} color={themeColors.accent} />
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      </TouchableOpacity>

      {currentData.file && (
        <SongDetailsModal
          visible={detailsVisible}
          filenames={[currentData.file]}
          onClose={() => setDetailsVisible(false)}
          onSave={() => {
            fetchFiles();
          }}
          onCleanPress={(filename) => {
            // Find file metadata for initial values
            const found = [...files.processed, ...files.raw].find(f => f.name === filename);
            setCleanModal({
              visible: true,
              filenames: [filename],
              rhythm: found?.metadata?.rhythm_factor || 1.0,
              melody: found?.metadata?.melody_factor || 1.0,
              profile: found?.metadata?.clean_profile || 'light'
            });
          }}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderTopWidth: 1,
    paddingTop: 5,
    elevation: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.1,
    shadowRadius: 5,
  },
  slider: {
    width: '100%',
    height: 20,
    marginTop: -10,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    height: 50,
  },
  toggleBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  info: {
    flex: 1,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  fileName: {
    fontSize: 13,
    fontWeight: '600',
  },
  time: {
    fontSize: 10,
    marginTop: 1,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
  }
});
