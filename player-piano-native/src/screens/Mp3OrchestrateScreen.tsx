import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, ScrollView, FlatList, Modal, TextInput, Platform, InteractionManager } from 'react-native';
import Slider from '@react-native-community/slider';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Audio } from 'expo-av';
import { useKeepAwake, activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Ionicons } from '@expo/vector-icons';
import * as IntentLauncher from 'expo-intent-launcher';
import { useStore } from '../store/useStore';
import { mp3Api, pianoApi, fileApi } from '../services/api';
import { Colors } from '../constants/Colors';
import { setAudioMode } from '../services/audioMode';
import { useAudioPlayer } from '../hooks/useAudioPlayer';

export const Mp3OrchestrateScreen = () => {
  const { theme } = useStore();
  const themeColors = Colors[theme];
  const { stop: stopGlobalPlayer } = useAudioPlayer();

  const [activeTab, setActiveTab] = useState<'create' | 'perform' | 'master' | 'library'>('create');
  const [search, setSearch] = useState('');
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<any>(null);
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [pianoSound, setPianoSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [syncOffset, setSyncOffset] = useState(0); // in ms
  const [library, setLibrary] = useState<any[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isReplacing, setIsReplacing] = useState(false);
  const [showMidiPicker, setShowMidiPicker] = useState(false);
  const [midiFiles, setMidiFiles] = useState<any[]>([]);
  const [showAudioPicker, setShowAudioPicker] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [uploadRouteMode, setUploadRouteMode] = useState<'piano' | 'speakers' | 'full_band'>('piano');
  const [uploadEngine, setUploadEngine] = useState<'bytedance' | 'basic_pitch'>('bytedance');
  const [uploadSensitivity, setUploadSensitivity] = useState(1.0);
  const [uploadIncludeOther, setUploadIncludeOther] = useState(false);

  // Settings Modal State (Now part of Master Tab)
  const [editName, setEditName] = useState('');
  const [editRhythm, setEditRhythm] = useState(1.0);
  const [editMelody, setEditMelody] = useState(1.0);
  const [editPedal, setEditPedal] = useState('light');
  const [editComments, setEditComments] = useState('');
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Auto-switch tabs based on state
  useEffect(() => {
    if (jobId && status?.status === 'completed' && activeTab === 'create') {
      setActiveTab('perform');
    }
  }, [jobId, status]);

  useEffect(() => {
    // Ensure app is in playback mode when entering this screen
    setAudioMode('playback');
    // Stop any audio playing from the main files screen to avoid hardware conflicts
    stopGlobalPlayer();
  }, []);

  const fetchLibrary = async () => {
    try {
      const jobs = await mp3Api.listJobs();
      setLibrary(jobs);
    } catch (e) {
      console.error('Failed to fetch library', e);
    }
  };

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      fetchLibrary();
    });
    return () => task.cancel();
  }, []);

  // Poll for status if jobId is set and not completed
  useEffect(() => {
    let timer: any;
    if (jobId && (!status || (status.status !== 'completed' && status.status !== 'failed'))) {
      timer = setInterval(async () => {
        try {
          const res = await mp3Api.getStatus(jobId);
          setStatus(res);
          if (res.status === 'completed') {
            clearInterval(timer);
            loadVocals(jobId);
            fetchLibrary();
          } else if (res.status === 'failed') {
            clearInterval(timer);
            Alert.alert('Processing Failed', res.error || 'Unknown error');
          }
        } catch (e) {
          console.error('Status poll failed', e);
        }
      }, 3000);
    }
    return () => clearInterval(timer);
  }, [jobId, status]);

  const loadVocals = async (id: string) => {
    try {
      if (sound) {
        await sound.unloadAsync();
      }
      const url = mp3Api.getVocalsUrl(id);
      console.log('[Orchestrate] Loading vocals from:', url);
      const { sound: newSound } = await Audio.Sound.createAsync(
        { uri: url },
        { shouldPlay: false, volume: 1.0 }
      );
      await newSound.setVolumeAsync(1.0);
      setSound(newSound);
      
      newSound.setOnPlaybackStatusUpdate((playbackStatus) => {
        if (playbackStatus.isLoaded) {
          if (!isPreviewing) setIsPlaying(playbackStatus.isPlaying);
          if (playbackStatus.didJustFinish) {
            handleStop();
          }
        }
      });
    } catch (e) {
      console.error('Failed to load vocals', e);
      Alert.alert('Error', 'Failed to load isolated vocals.');
    }
  };

  const openSettings = () => {
    if (!status) return;
    setEditName(status.original_name);
    setEditRhythm(status.rhythm_factor || 1.0);
    setEditMelody(status.melody_factor || 1.0);
    setEditPedal(status.pedal_preset || 'light');
    setEditComments(status.comments || '');
    setShowSettings(true);
  };

  const handleSaveSettings = async () => {
    if (!jobId) return;
    setIsSavingSettings(true);
    try {
      await mp3Api.updateSettings(jobId, {
        original_name: editName,
        rhythm_factor: editRhythm,
        melody_factor: editMelody,
        pedal_preset: editPedal,
        comments: editComments
      });
      // Refresh local state
      const updatedStatus = await mp3Api.getStatus(jobId);
      setStatus(updatedStatus);
      fetchLibrary();
      // If we had a piano sound loaded, it's now invalid because the MIDI changed
      if (pianoSound) {
        await pianoSound.unloadAsync();
        setPianoSound(null);
      }
      setShowSettings(false);
    } catch (e) {
      Alert.alert('Error', 'Failed to save settings.');
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handlePickAndUpload = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      const file = result.assets[0];
      setUploading(true);
      setJobId(null);
      setStatus(null);
      if (sound) { await sound.unloadAsync(); setSound(null); }
      if (pianoSound) { await pianoSound.unloadAsync(); setPianoSound(null); }

      console.log('[Orchestrate] Reading file...');
      let base64Data = '';
      if (Platform.OS === 'web') {
        const response = await fetch(file.uri);
        const blob = await response.blob();
        base64Data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const resultStr = reader.result as string;
            const base64 = resultStr.split(',')[1];
            resolve(base64);
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } else {
        base64Data = await FileSystem.readAsStringAsync(file.uri, {
          encoding: 'base64',
        });
      }

      console.log('[Orchestrate] Uploading with mode:', uploadRouteMode, 'engine:', uploadEngine, 'sensitivity:', uploadSensitivity, 'includeOther:', uploadIncludeOther);
      const res = await mp3Api.upload(file.name || 'audio.mp3', base64Data, uploadRouteMode, uploadEngine, uploadSensitivity, uploadIncludeOther);
      setJobId(res.job_id);
      setUploading(false);
    } catch (e: any) {
      console.error('[Orchestrate] Error:', e);
      Alert.alert('Upload Failed', e.message);
      setUploading(false);
    }
  };

  const toggleJobSelection = (job_id: string) => {
    setSelectedJobs(prev => {
      const next = new Set(prev);
      if (next.has(job_id)) {
        next.delete(job_id);
        if (next.size === 0) setSelectionMode(false);
      } else {
        next.add(job_id);
        setSelectionMode(true);
      }
      return next;
    });
  };

  const selectFromLibrary = (job: any) => {
    if (selectionMode) {
      toggleJobSelection(job.job_id);
      return;
    }

    try {
      setJobId(job.job_id);
      setStatus(job);
      loadVocals(job.job_id);
      if (pianoSound) {
        pianoSound.unloadAsync();
        setPianoSound(null);
      }
      setActiveTab('perform');
    } catch (e) {
      console.error('Failed to select from library', e);
      Alert.alert('Error', 'Failed to load selected track.');
    }
  };

  const handleBulkDelete = () => {
    if (selectedJobs.size === 0) return;
    Alert.alert(
      'Delete Songs',
      `Are you sure you want to delete ${selectedJobs.size} processed songs? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete All', 
          style: 'destructive', 
          onPress: async () => {
            try {
              for (const id of selectedJobs) {
                await mp3Api.deleteJob(id);
                if (jobId === id) {
                  setJobId(null);
                  setStatus(null);
                  if (sound) { await sound.unloadAsync(); setSound(null); }
                  if (pianoSound) { await pianoSound.unloadAsync(); setPianoSound(null); }
                }
              }
              setSelectedJobs(new Set());
              setSelectionMode(false);
              fetchLibrary();
            } catch (e) {
              Alert.alert('Error', 'Failed to delete some songs.');
            }
          } 
        }
      ]
    );
  };

  const openMidiPicker = async () => {
    try {
      const res = await fileApi.listFiles();
      // Combine processed and raw, but prefer processed
      const files = [...res.processed, ...res.raw.filter((r: any) => !res.processed.some((p: any) => p.name === r.name.replace('_original', '')))];
      setMidiFiles(files);
      setShowMidiPicker(true);
    } catch (e) {
      Alert.alert('Error', 'Failed to load MIDI library.');
    }
  };

  const handleSelectMidi = async (filename: string) => {
    if (!jobId) return;
    try {
      setShowMidiPicker(false);
      setIsReplacing(true);
      await mp3Api.replaceMidiExisting(jobId, filename);
      Alert.alert('Hybrid Alignment Complete', 'The selected MIDI has been warped to match the MP3 vocals!');
      const updatedStatus = await mp3Api.getStatus(jobId);
      setStatus(updatedStatus);
      fetchLibrary();
      if (pianoSound) {
        await pianoSound.unloadAsync();
        setPianoSound(null);
      }
    } catch (e: any) {
      console.error('Alignment failed', e);
      Alert.alert('Alignment Error', 'Failed to align the selected MIDI.');
    } finally {
      setIsReplacing(false);
    }
  };

  const handleSelectAudio = async (selectedJobId: string) => {
    if (!jobId) return;
    try {
      setShowAudioPicker(false);
      setIsMerging(true);
      // We are in the current job (which has the MIDI we want),
      // and we want to replace its audio with the audio from selectedJobId.
      // So midi_job_id = jobId, audio_job_id = selectedJobId.
      const res = await mp3Api.mergeJobs(jobId, selectedJobId);
      setJobId(res.job_id);
      Alert.alert('Hybrid Created', 'Created a new master track combining this MIDI with the selected accompaniment!');
      const updatedStatus = await mp3Api.getStatus(res.job_id);
      setStatus(updatedStatus);
      
      // CRITICAL FIX: Reload the vocals for the new hybrid job
      loadVocals(res.job_id);
      
      fetchLibrary();
      if (pianoSound) {
        await pianoSound.unloadAsync();
        setPianoSound(null);
      }
    } catch (e: any) {
      console.error('Merge failed', e);
      const detail = e.response?.data?.detail || e.message || 'Unknown error';
      Alert.alert('Merge Error', `Failed to combine tracks: ${detail}`);
    } finally {
      setIsMerging(false);
    }
  };

  const handleReplaceMidi = async () => {
    if (!jobId) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['audio/midi', 'audio/x-midi', 'application/x-midi'],
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      setIsReplacing(true);
      const file = result.assets[0];
      
      await mp3Api.replaceMidi(jobId, file.uri);
      
      Alert.alert('Hybrid Alignment Complete', 'Your high-quality MIDI has been warped to match the MP3 vocals!');
      
      const updatedStatus = await mp3Api.getStatus(jobId);
      setStatus(updatedStatus);
      fetchLibrary();
      if (pianoSound) {
        await pianoSound.unloadAsync();
        setPianoSound(null);
      }
    } catch (e: any) {
      console.error('MIDI replacement failed', e);
      Alert.alert('Alignment Error', e.message || 'Failed to align MIDI.');
    } finally {
      setIsReplacing(false);
    }
  };

  const handleDeleteJob = (job: any) => {
    Alert.alert(
      'Delete Song',
      `Are you sure you want to delete "${job.original_name}"? This will remove all processed files.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive', 
          onPress: async () => {
            try {
              await mp3Api.deleteJob(job.job_id);
              if (jobId === job.job_id) {
                setJobId(null);
                setStatus(null);
                if (sound) { await sound.unloadAsync(); setSound(null); }
                if (pianoSound) { await pianoSound.unloadAsync(); setPianoSound(null); }
              }
              fetchLibrary();
            } catch (e) {
              Alert.alert('Error', 'Failed to delete song.');
            }
          } 
        }
      ]
    );
  };

  const handlePlay = async () => {
    if (!jobId || !sound) {
      Alert.alert('Not Ready', 'Wait for processing to complete and vocals to load.');
      return;
    }

    try {
      // 1. Activate Keep-Awake to prevent background suspension
      await activateKeepAwakeAsync();
      console.log('[Orchestrate] Background protection active.');

      // Offset logic: 
      // positive = delay MIDI (vocal first)
      // negative = delay Vocal (MIDI first)
      
      if (syncOffset >= 0) {
        // Play vocals immediately
        await sound.playAsync();
        // Delay MIDI
        if (syncOffset > 0) {
          setTimeout(async () => {
            await mp3Api.playMidi(jobId);
          }, syncOffset);
        } else {
          await mp3Api.playMidi(jobId);
        }
      } else {
        // Play MIDI immediately
        await mp3Api.playMidi(jobId);
        // Delay vocals
        setTimeout(async () => {
          await sound.playAsync();
        }, Math.abs(syncOffset));
      }
      setIsPlaying(true);
      setIsPreviewing(false);
    } catch (e) {
      console.error('Playback failed', e);
      Alert.alert('Playback Error', 'Failed to start synchronized playback.');
    }
  };

  const handleLocalPreview = async (mode: 'vocals' | 'piano' | 'both') => {
    if (!jobId || !sound) return;

    try {
      setIsRendering(true);
      setIsPreviewing(true);

      let currentPianoSound = pianoSound;
      if (mode === 'piano' || mode === 'both') {
        if (!currentPianoSound) {
          console.log('[Orchestrate] Rendering piano audio...');
          const renderUrl = mp3Api.getPianoRenderUrl(jobId);
          const { sound: newPiano } = await Audio.Sound.createAsync(
            { uri: renderUrl },
            { shouldPlay: false, volume: 1.0 }
          );
          setPianoSound(newPiano);
          currentPianoSound = newPiano;
        }
      }

      setIsRendering(false);

      // Play according to mode
      if (mode === 'vocals') {
        await sound.setPositionAsync(0);
        await sound.playAsync();
      } else if (mode === 'piano') {
        if (currentPianoSound) {
          await currentPianoSound.setPositionAsync(0);
          await currentPianoSound.playAsync();
        }
      } else if (mode === 'both') {
        // Sync them locally
        await sound.setPositionAsync(0);
        if (currentPianoSound) await currentPianoSound.setPositionAsync(0);
        
        // Offset logic for local preview
        if (syncOffset >= 0) {
          await sound.playAsync();
          if (syncOffset > 0) {
            setTimeout(async () => { if (currentPianoSound) await currentPianoSound.playAsync(); }, syncOffset);
          } else {
            if (currentPianoSound) await currentPianoSound.playAsync();
          }
        } else {
          if (currentPianoSound) await currentPianoSound.playAsync();
          setTimeout(async () => { await sound.playAsync(); }, Math.abs(syncOffset));
        }
      }
      setIsPlaying(true);
    } catch (e) {
      console.error('Preview failed', e);
      Alert.alert('Error', 'Failed to start local preview.');
      setIsRendering(false);
      setIsPreviewing(false);
    }
  };

  const handleStop = async () => {
    // Force UI to update immediately to prevent double-taps
    setIsPlaying(false);
    setIsPreviewing(false);

    try {
      if (sound) {
        await sound.stopAsync().catch(() => {});
      }
    } catch (e) {}

    try {
      if (pianoSound) {
        await pianoSound.stopAsync().catch(() => {});
      }
    } catch (e) {}

    try {
      await pianoApi.stop();
    } catch (e) {}
    
    try {
      // Deactivate Keep-Awake when stopped to save battery
      await deactivateKeepAwake();
      console.log('[Orchestrate] Background protection disabled.');
    } catch (e) {}
  };

  useEffect(() => {
    // Cleanup keep-awake on unmount
    return () => {
      deactivateKeepAwake();
    };
  }, []);

  const handleAutoSync = async () => {
    if (!jobId || !sound) return;

    try {
      const { status: perm } = await Audio.requestPermissionsAsync();
      if (perm !== 'granted') {
        Alert.alert('Permission Denied', 'Microphone access is required for auto-sync.');
        return;
      }

      setIsSyncing(true);
      
      // 1. Prepare recording
      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      
      // 2. Start Recording
      await recording.startAsync();
      
      // 3. Play the preamble WITH CURRENT OFFSET to measure remaining error
      if (syncOffset >= 0) {
        await sound.playAsync();
        if (syncOffset > 0) {
          setTimeout(async () => { await mp3Api.playMidi(jobId); }, syncOffset);
        } else {
          await mp3Api.playMidi(jobId);
        }
      } else {
        await mp3Api.playMidi(jobId);
        setTimeout(async () => { await sound.playAsync(); }, Math.abs(syncOffset));
      }

      // 4. Wait for 5 seconds of the preamble
      setTimeout(async () => {
        try {
          await recording.stopAndUnloadAsync();
          await sound.stopAsync();
          await pianoApi.stop();
          
          const uri = recording.getURI();
          if (uri) {
            const res = await mp3Api.autoSync(uri);
            if (res.offset_ms !== undefined) {
              const newOffset = Math.round(syncOffset + res.offset_ms);
              const clampedOffset = Math.max(-1000, Math.min(1000, newOffset));
              setSyncOffset(clampedOffset);
              
              if (Math.abs(res.offset_ms) < 15) {
                Alert.alert('Perfect Sync!', `Remaining error only ${res.offset_ms}ms. You are locked in!`);
              } else {
                Alert.alert('Refining Sync', `Adjusted by ${res.offset_ms}ms. Total offset: ${clampedOffset}ms. Try once more to perfect it!`);
              }
            }
          }
        } catch (e) {
          console.error('Auto-sync finalization failed', e);
        } finally {
          setIsSyncing(false);
        }
      }, 5000);

    } catch (e) {
      console.error('Auto-sync failed', e);
      Alert.alert('Error', 'Auto-sync failed to initialize.');
      setIsSyncing(false);
    }
  };

  const renderTags = (job: any, inline: boolean = false) => {
    const tags = [];
    
    // Routing Mode Tags
    if (job.route_mode === 'hybrid') {
        tags.push({ label: 'HYBRID', color: themeColors.accent });
    } else if (job.route_mode === 'full_band') {
        tags.push({ label: 'FB', color: themeColors.accent });
    } else if (job.route_mode === 'speakers') {
        tags.push({ label: 'VB', color: themeColors.accent });
    }

    // Engine Tags
    if (job.engine === 'basic_pitch') {
        tags.push({ label: 'POLY', color: themeColors.textMuted });
    } else {
        tags.push({ label: 'PIANO', color: themeColors.textMuted });
    }

    // Inclusion Tag
    if (job.include_other) {
        tags.push({ label: '+STRINGS', color: '#4CAF50' });
    }

    // Sensitivity Tag
    if (job.engine_sensitivity && job.engine_sensitivity !== 1.0) {
        tags.push({ label: `S:${job.engine_sensitivity.toFixed(1)}x`, color: themeColors.textMuted });
    }

    if (inline) {
      return (
        <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap' }}>
          {tags.map((tag, idx) => (
            <View key={idx} style={{ backgroundColor: tag.color + '15', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 3, borderWidth: 1, borderColor: tag.color + '22' }}>
              <Text style={{ fontSize: 8, color: tag.color, fontWeight: '700' }}>{tag.label}</Text>
            </View>
          ))}
        </View>
      );
    }

    return (
      <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
        {tags.map((tag, idx) => (
          <View key={idx} style={{ backgroundColor: tag.color + '22', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, borderWidth: 1, borderColor: tag.color + '44' }}>
            <Text style={{ fontSize: 9, color: tag.color, fontWeight: '700' }}>{tag.label}</Text>
          </View>
        ))}
      </View>
    );
  };

  const renderPlusMinus = (label: string, value: number, setter: (v: number) => void) => (
    <View style={styles.tuningRow}>
      <Text style={[styles.tuningLabel, { color: themeColors.text }]}>{label}</Text>
      <View style={styles.plusMinusBox}>
        <TouchableOpacity style={styles.plusMinusBtn} onPress={() => setter(Math.max(0.1, +(value - 0.05).toFixed(2)))}>
          <Ionicons name="remove" size={20} color={themeColors.text} />
        </TouchableOpacity>
        <Text style={[styles.plusMinusVal, { color: themeColors.text }]}>{value.toFixed(2)}x</Text>
        <TouchableOpacity style={styles.plusMinusBtn} onPress={() => setter(Math.min(3.0, +(value + 0.05).toFixed(2)))}>
          <Ionicons name="add" size={20} color={themeColors.text} />
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderTabBar = () => (
    <View style={[styles.tabBar, { borderBottomColor: themeColors.border }]}>
      {[
        { id: 'create', icon: 'cloud-upload-outline', label: 'CREATE' },
        { id: 'perform', icon: 'musical-notes-outline', label: 'PERFORM' },
        { id: 'master', icon: 'options-outline', label: 'MASTER' },
        { id: 'library', icon: 'library-outline', label: 'LIBRARY' },
      ].map((tab) => (
        <TouchableOpacity
          key={tab.id}
          style={[styles.tabItem, activeTab === tab.id && { borderBottomColor: themeColors.accent, borderBottomWidth: 3 }]}
          onPress={() => setActiveTab(tab.id as any)}
        >
          <Ionicons name={tab.icon as any} size={20} color={activeTab === tab.id ? themeColors.accent : themeColors.textMuted} />
          <Text style={[styles.tabLabel, { color: activeTab === tab.id ? themeColors.accent : themeColors.textMuted }]}>{tab.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: themeColors.text }]}>MP3 Orchestrator</Text>
        {jobId && status?.status === 'completed' && (
           <Text style={{ fontSize: 10, color: themeColors.accent, fontWeight: '700' }}>ACTIVE: #{jobId.substring(0, 4)}</Text>
        )}
      </View>

      {renderTabBar()}

      {/* Floating Status Card at the Top */}
      {(uploading || (jobId && status && status.status !== 'completed' && status.status !== 'failed')) && (
        <View style={[styles.floatingStatus, { backgroundColor: themeColors.surface, borderColor: themeColors.accent }]}>
          <ActivityIndicator color={themeColors.accent} size="small" />
          <View style={{ flex: 1, marginLeft: 15 }}>
            <Text style={[styles.statusTitle, { color: themeColors.text, marginTop: 0, fontSize: 14 }]}>
              {uploading ? 'Uploading MP3...' : 
               status.status === 'separating' ? 'Separating Stems...' : 
               status.status === 'transcribing' ? 'Transcribing Piano...' : 'Final Cleaning...'}
            </Text>
            {!uploading && <Text style={{ fontSize: 10, color: themeColors.textMuted }}>Progress: {status.progress}%</Text>}
          </View>
        </View>
      )}

      <View style={{ flex: 1 }}>
        {activeTab === 'library' ? (
          <View style={{ flex: 1, width: '100%' }}>
            <View style={{ padding: 15, borderBottomWidth: 1, borderBottomColor: themeColors.border }}>
              <TextInput
                style={[styles.searchBar, { backgroundColor: themeColors.surface, color: themeColors.text, borderColor: themeColors.border, borderWidth: 1 }]}
                placeholder="Search processed songs..."
                placeholderTextColor={themeColors.textMuted}
                value={search}
                onChangeText={setSearch}
              />
            </View>

            {selectionMode && (
              <View style={[styles.actionBar, { backgroundColor: themeColors.accent }]}>
                <View style={styles.actionCount}>
                  <Ionicons name="checkmark-circle" size={24} color="#fff" />
                  <Text style={styles.actionCountText}>{selectedJobs.size} Selected</Text>
                </View>
                <View style={[styles.actionButtons, { flexDirection: 'row' }]}>
                  <TouchableOpacity style={styles.barBtn} onPress={handleBulkDelete}>
                    <Ionicons name="trash-outline" size={24} color="#fff" />
                    <Text style={styles.barBtnText}>Delete</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.barBtn} onPress={() => { setSelectionMode(false); setSelectedJobs(new Set()); }}>
                    <Ionicons name="close" size={24} color="#fff" />
                    <Text style={styles.barBtnText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <FlatList
              data={library.filter(j => j.status === 'completed' && j.original_name.toLowerCase().replace(/[-_]/g, ' ').includes(search.toLowerCase().replace(/[-_]/g, ' ')))}
              keyExtractor={item => item.job_id}
              contentContainerStyle={{ paddingBottom: 100 }}
              renderItem={({ item }) => {
                const isSelected = selectedJobs.has(item.job_id);
                const isActive = jobId === item.job_id;
                return (
                  <TouchableOpacity 
                    style={[styles.fileItem, isSelected && { backgroundColor: themeColors.accent + '22' }, { borderBottomColor: themeColors.border }]}
                    onPress={() => selectFromLibrary(item)}
                    onLongPress={() => toggleJobSelection(item.job_id)}
                  >
                    <View style={styles.selectionIndicator}>
                      <Ionicons 
                        name={isSelected ? "checkmark-circle" : "ellipse-outline"} 
                        size={24} 
                        color={isSelected ? themeColors.accent : themeColors.textMuted} 
                      />
                    </View>
                    <View style={styles.fileInfo}>
                      <View style={styles.titleRow}>
                        <Text style={[styles.fileName, { color: isActive ? themeColors.accent : themeColors.text }]} numberOfLines={1}>
                          {item.original_name}
                        </Text>
                      </View>
                    <View style={styles.metaRow}>
                      <Text style={[styles.fileMeta, { color: themeColors.textMuted }]}>
                        {new Date(item.timestamp * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} • #{item.job_id.substring(0, 4)}
                      </Text>
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        {renderTags(item, true)}
                      </View>
                    </View>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={themeColors.textMuted} />
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <Text style={[styles.emptyText, { color: themeColors.textMuted }]}>No songs found.</Text>
              }
            />
          </View>
        ) : (
          <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 120 }]} keyboardShouldPersistTaps="handled">
            {activeTab === 'create' && (
              <View style={{ width: '100%', alignItems: 'center' }}>
                <Text style={[styles.description, { color: themeColors.textMuted }]}>
                  Upload an MP3 to separate vocals and piano. Play them back in sync to your speakers and Disklavier.
                </Text>

                {!uploading && !jobId && (
                  <View style={{ width: '100%', alignItems: 'center' }}>
                    <Text style={[styles.fieldLabel, { color: themeColors.textMuted, marginBottom: 15 }]}>Transcription Engine</Text>
                    <View style={[styles.pedalRow, { marginBottom: 20 }]}>
                      <TouchableOpacity 
                        style={[styles.pedalBtn, { borderColor: themeColors.border }, uploadEngine === 'bytedance' && { backgroundColor: themeColors.accent, borderColor: themeColors.accent }]} 
                        onPress={() => setUploadEngine('bytedance')}
                      >
                        <Text style={[styles.pedalBtnText, { color: themeColors.text }, uploadEngine === 'bytedance' && { color: '#fff' }]}>PIANO-FOCUSED</Text>
                      </TouchableOpacity>
                      <TouchableOpacity 
                        style={[styles.pedalBtn, { borderColor: themeColors.border }, uploadEngine === 'basic_pitch' && { backgroundColor: themeColors.accent, borderColor: themeColors.accent }]} 
                        onPress={() => setUploadEngine('basic_pitch')}
                      >
                        <Text style={[styles.pedalBtnText, { color: themeColors.text }, uploadEngine === 'basic_pitch' && { color: '#fff' }]}>POLYPHONIC</Text>
                      </TouchableOpacity>
                    </View>

                    <View style={{ width: '100%', marginBottom: 20 }}>
                      {renderPlusMinus("Transcription Sensitivity", uploadSensitivity, setUploadSensitivity)}
                      <Text style={{ fontSize: 10, color: themeColors.textMuted, textAlign: 'center', marginTop: 5 }}>
                        {uploadEngine === 'bytedance' 
                          ? "Adjusts audio gain for cleaner capture. Increase if notes are missing." 
                          : "Adjusts AI thresholds for softer instruments (Violin/Strings)."}
                      </Text>
                    </View>

                    <Text style={[styles.fieldLabel, { color: themeColors.textMuted, marginBottom: 15 }]}>Instrument Routing Mode</Text>
                    <View style={styles.pedalRow}>
                      <TouchableOpacity 
                        style={[styles.pedalBtn, { borderColor: themeColors.border }, uploadRouteMode === 'piano' && { backgroundColor: themeColors.accent, borderColor: themeColors.accent }]} 
                        onPress={() => setUploadRouteMode('piano')}
                      >
                        <Text style={[styles.pedalBtnText, { color: themeColors.text }, uploadRouteMode === 'piano' && { color: '#fff' }]}>PIANO (ALL)</Text>
                      </TouchableOpacity>
                      <TouchableOpacity 
                        style={[styles.pedalBtn, { borderColor: themeColors.border }, uploadRouteMode === 'speakers' && { backgroundColor: themeColors.accent, borderColor: themeColors.accent }]} 
                        onPress={() => setUploadRouteMode('speakers')}
                      >
                        <Text style={[styles.pedalBtnText, { color: themeColors.text }, uploadRouteMode === 'speakers' && { color: '#fff' }]}>VIRTUAL BAND</Text>
                      </TouchableOpacity>
                      <TouchableOpacity 
                        style={[styles.pedalBtn, { borderColor: themeColors.border }, uploadRouteMode === 'full_band' && { backgroundColor: themeColors.accent, borderColor: themeColors.accent }]} 
                        onPress={() => setUploadRouteMode('full_band')}
                      >
                        <Text style={[styles.pedalBtnText, { color: themeColors.text }, uploadRouteMode === 'full_band' && { color: '#fff' }]}>FULL BAND</Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={{ fontSize: 11, color: themeColors.textMuted, textAlign: 'center', marginBottom: 25, paddingHorizontal: 20 }}>
                      {uploadRouteMode === 'piano' 
                        ? "Drums, Bass, and Other will be transcribed to piano MIDI." 
                        : uploadRouteMode === 'speakers'
                          ? "Drums and Bass will play through speakers. Only piano/guitar goes to MIDI."
                          : "ALL instruments play through speakers. Piano part also transcribed to MIDI."}
                    </Text>

                    <View style={[styles.tuningRow, { width: '100%', marginBottom: 30, paddingHorizontal: 10 }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.tuningLabel, { color: themeColors.text }]}>Include 'Other' in MIDI</Text>
                        <Text style={{ fontSize: 10, color: themeColors.textMuted }}>Merges Strings/Synths into transcription. Helps if notes are missing.</Text>
                      </View>
                      <TouchableOpacity 
                        onPress={() => setUploadIncludeOther(!uploadIncludeOther)}
                        style={{ 
                          width: 50, height: 30, borderRadius: 15, 
                          backgroundColor: uploadIncludeOther ? themeColors.accent : themeColors.border,
                          justifyContent: 'center', paddingHorizontal: 5
                        }}
                      >
                        <View style={{ 
                          width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff',
                          alignSelf: uploadIncludeOther ? 'flex-end' : 'flex-start'
                        }} />
                      </TouchableOpacity>
                    </View>

                    <TouchableOpacity 
                      style={[styles.btn, { backgroundColor: themeColors.accent }]} 
                      onPress={handlePickAndUpload}
                    >
                      <Text style={styles.btnText}>Select MP3</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {jobId && status?.status === 'completed' && (
                  <View style={{ padding: 40, alignItems: 'center' }}>
                    <Ionicons name="checkmark-circle-outline" size={64} color="#4CAF50" />
                    <Text style={{ color: themeColors.text, fontSize: 18, fontWeight: '700', marginTop: 20 }}>Track Ready!</Text>
                    <Text style={{ color: themeColors.textMuted, textAlign: 'center', marginTop: 10 }}>Switch to the PERFORM tab to play it on your piano.</Text>
                    <TouchableOpacity 
                      style={[styles.btn, { backgroundColor: themeColors.surface, marginTop: 30, borderWidth: 1, borderColor: themeColors.border }]} 
                      onPress={() => { setJobId(null); setStatus(null); }}
                    >
                      <Text style={[styles.btnText, { color: themeColors.text }]}>Process Another Song</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}

            {activeTab === 'perform' && (
              <View style={{ width: '100%', alignItems: 'center' }}>
                {!jobId ? (
                   <View style={{ padding: 40, alignItems: 'center' }}>
                     <Ionicons name="musical-notes-outline" size={64} color={themeColors.border} />
                     <Text style={{ color: themeColors.textMuted, marginTop: 20, textAlign: 'center' }}>No active song. Upload one or select from Library.</Text>
                   </View>
                ) : status?.status === 'completed' ? (
                  <View style={styles.controls}>
                    <View style={[styles.card, { backgroundColor: themeColors.surface, borderColor: themeColors.border, borderWidth: 1 }]}>
                      <View style={{ justifyContent: 'center', alignItems: 'center', marginBottom: 20 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                          <Text style={[styles.cardTitle, { color: themeColors.text, marginBottom: 0 }]}>{status.original_name}</Text>
                          <Text style={{ color: themeColors.textMuted, fontSize: 10 }}>#{status.job_id.substring(0, 4)}</Text>
                        </View>
                        {renderTags(status)}
                      </View>
                      
                      <View style={styles.row}>
                        {!isPlaying ? (
                          <View style={{ flexDirection: 'row', gap: 20 }}>
                            <TouchableOpacity style={[styles.playBtn, { backgroundColor: themeColors.accent }]} onPress={handlePlay}>
                              <Ionicons name="play" size={32} color="#fff" />
                            </TouchableOpacity>
                            
                            <TouchableOpacity 
                              style={[styles.playBtn, { backgroundColor: themeColors.surface, borderWidth: 2, borderColor: themeColors.accent }]} 
                              onPress={handleAutoSync}
                              disabled={isSyncing}
                            >
                              {isSyncing ? (
                                <ActivityIndicator color={themeColors.accent} />
                              ) : (
                                <Ionicons name="mic-outline" size={32} color={themeColors.accent} />
                              )}
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <TouchableOpacity style={[styles.playBtn, { backgroundColor: '#f44' }]} onPress={handleStop}>
                            <Ionicons name="stop" size={32} color="#fff" />
                          </TouchableOpacity>
                        )}
                      </View>

                      <View style={styles.syncBox}>
                        <Text style={[styles.label, { color: themeColors.text }]}>Sync Offset: {syncOffset}ms</Text>
                        <Text style={[styles.subLabel, { color: themeColors.textMuted }]}>
                          {syncOffset > 0 ? 'MIDI is delayed' : syncOffset < 0 ? 'Vocals are delayed' : 'Perfect Sync'}
                        </Text>
                        <View style={styles.fineTuneRow}>
                          <TouchableOpacity 
                            style={[styles.miniPlusMinusBtn, { backgroundColor: themeColors.border }]} 
                            onPress={() => setSyncOffset(prev => Math.max(-1000, prev - 10))}
                          >
                            <Ionicons name="remove" size={20} color={themeColors.text} />
                          </TouchableOpacity>
                          
                          <Slider
                            style={{ flex: 1, height: 40 }}
                            minimumValue={-1000}
                            maximumValue={1000}
                            step={10}
                            value={syncOffset}
                            onValueChange={setSyncOffset}
                            minimumTrackTintColor={themeColors.accent}
                            maximumTrackTintColor={themeColors.border}
                            thumbTintColor={themeColors.accent}
                          />

                          <TouchableOpacity 
                            style={[styles.miniPlusMinusBtn, { backgroundColor: themeColors.border }]} 
                            onPress={() => setSyncOffset(prev => Math.min(1000, prev + 10))}
                          >
                            <Ionicons name="add" size={20} color={themeColors.text} />
                          </TouchableOpacity>
                        </View>
                      </View>
                      
                      {status.comments ? (
                         <Text style={[styles.commentNote, { color: themeColors.textMuted }]}>
                           Note: {status.comments}
                         </Text>
                      ) : null}
                    </View>
                  </View>
                ) : (
                   <View style={{ marginTop: 100, alignItems: 'center' }}>
                      <ActivityIndicator color={themeColors.accent} size="large" />
                      <Text style={{ color: themeColors.textMuted, marginTop: 20 }}>Processing in progress...</Text>
                   </View>
                )}
              </View>
            )}

            {activeTab === 'master' && (
              <View style={{ width: '100%', alignItems: 'center' }}>
                {!jobId ? (
                   <View style={{ padding: 40, alignItems: 'center' }}>
                     <Ionicons name="hammer-outline" size={64} color={themeColors.border} />
                     <Text style={{ color: themeColors.textMuted, marginTop: 20, textAlign: 'center' }}>Select a song from Library to master.</Text>
                   </View>
                ) : (
                  <View style={{ width: '100%' }}>
                    {/* Mixing & Previews */}
                    <View style={[styles.card, { backgroundColor: themeColors.surface, borderColor: themeColors.border, borderWidth: 1, marginBottom: 20 }]}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
                        <Text style={[styles.fieldLabel, { color: themeColors.textMuted, marginBottom: 0 }]}>Audio Mixing (Speakers)</Text>
                        {isPlaying && (
                          <TouchableOpacity onPress={handleStop} style={{ paddingHorizontal: 10 }}>
                            <Ionicons name="stop-circle" size={24} color="#f44" />
                          </TouchableOpacity>
                        )}
                      </View>
                      
                      {isRendering ? (
                        <View style={{ padding: 20, alignItems: 'center' }}>
                          <ActivityIndicator color={themeColors.accent} />
                          <Text style={{ color: themeColors.textMuted, marginTop: 10, fontSize: 12 }}>Synthesizing piano audio...</Text>
                        </View>
                      ) : (
                        <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'center' }}>
                          <TouchableOpacity 
                            style={[styles.previewBtn, { backgroundColor: themeColors.border }]} 
                            onPress={() => handleLocalPreview('vocals')}
                          >
                            <Text style={[styles.previewBtnText, { color: themeColors.text }]}>Vocals</Text>
                          </TouchableOpacity>
                          <TouchableOpacity 
                            style={[styles.previewBtn, { backgroundColor: themeColors.border }]} 
                            onPress={() => handleLocalPreview('piano')}
                          >
                            <Text style={[styles.previewBtnText, { color: themeColors.text }]}>Piano</Text>
                          </TouchableOpacity>
                          <TouchableOpacity 
                            style={[styles.previewBtn, { backgroundColor: themeColors.accent }]} 
                            onPress={() => handleLocalPreview('both')}
                          >
                            <Text style={[styles.previewBtnText, { color: '#fff' }]}>Both</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>

                    {/* Advanced Replacement */}
                    <View style={[styles.card, { backgroundColor: themeColors.surface, borderColor: themeColors.border, borderWidth: 1, marginBottom: 20 }]}>
                      <Text style={[styles.fieldLabel, { color: themeColors.textMuted }]}>Advanced Hybrid Tools</Text>
                      <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                        <TouchableOpacity 
                          style={[styles.hybridBtn, { flex: 1, borderColor: themeColors.accent, marginTop: 0 }]}
                          onPress={handleReplaceMidi}
                          disabled={isReplacing}
                        >
                          {isReplacing ? <ActivityIndicator color={themeColors.accent} size="small" /> : (
                            <>
                              <Ionicons name="cloud-upload-outline" size={18} color={themeColors.accent} />
                              <Text style={[styles.hybridBtnText, { color: themeColors.accent }]}>Warp MIDI</Text>
                            </>
                          )}
                        </TouchableOpacity>

                        <TouchableOpacity 
                          style={[styles.hybridBtn, { flex: 1, borderColor: themeColors.accent, marginTop: 0 }]}
                          onPress={openMidiPicker}
                          disabled={isReplacing || isMerging}
                        >
                          <Ionicons name="library-outline" size={18} color={themeColors.accent} />
                          <Text style={[styles.hybridBtnText, { color: themeColors.accent }]}>Pick MIDI</Text>
                        </TouchableOpacity>
                      </View>

                      <TouchableOpacity 
                        style={[styles.hybridBtn, { width: '100%', borderColor: themeColors.accent, marginTop: 10 }]}
                        onPress={() => setShowAudioPicker(true)}
                        disabled={isReplacing || isMerging}
                      >
                        {isMerging ? <ActivityIndicator color={themeColors.accent} size="small" /> : (
                          <>
                            <Ionicons name="musical-notes-outline" size={18} color={themeColors.accent} />
                            <Text style={[styles.hybridBtnText, { color: themeColors.accent }]}>Replace Audio (Hybrid Merge)</Text>
                          </>
                        )}
                      </TouchableOpacity>
                    </View>

                    {/* Fine Tuning */}
                    <View style={[styles.card, { backgroundColor: themeColors.surface, borderColor: themeColors.border, borderWidth: 1, marginBottom: 20 }]}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                          <Text style={[styles.fieldLabel, { color: themeColors.textMuted, marginBottom: 0 }]}>Piano Settings</Text>
                          <TouchableOpacity onPress={openSettings}>
                             <Text style={{ color: themeColors.accent, fontSize: 12, fontWeight: '700' }}>EDIT DETAILS</Text>
                          </TouchableOpacity>
                        </View>

                        <View style={{ gap: 15 }}>
                           <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                              <Text style={{ color: themeColors.textMuted, fontSize: 12 }}>Pedal Profile</Text>
                              <Text style={{ color: themeColors.text, fontSize: 12, fontWeight: '700' }}>{status.pedal_preset?.toUpperCase() || 'LIGHT'}</Text>
                           </View>
                           <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                              <Text style={{ color: themeColors.textMuted, fontSize: 12 }}>Velocity (Melody)</Text>
                              <Text style={{ color: themeColors.text, fontSize: 12, fontWeight: '700' }}>{status.melody_factor?.toFixed(2)}x</Text>
                           </View>
                           <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                              <Text style={{ color: themeColors.textMuted, fontSize: 12 }}>Velocity (Rhythm)</Text>
                              <Text style={{ color: themeColors.text, fontSize: 12, fontWeight: '700' }}>{status.rhythm_factor?.toFixed(2)}x</Text>
                           </View>
                        </View>
                    </View>

                    <TouchableOpacity 
                      style={[styles.btn, { backgroundColor: themeColors.surface, marginTop: 20, borderWidth: 1, borderColor: themeColors.border }]} 
                      onPress={() => { setJobId(null); setStatus(null); setActiveTab('create'); }}
                    >
                      <Text style={[styles.btnText, { color: themeColors.text }]}>Close Active Song</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}
          </ScrollView>
        )}
      </View>

      {/* Piano Settings Modal */}
      <Modal visible={showSettings} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: themeColors.surface }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: themeColors.text }]}>Song Options</Text>
              <TouchableOpacity onPress={() => setShowSettings(false)}>
                <Ionicons name="close" size={24} color={themeColors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView>
              <Text style={[styles.fieldLabel, { color: themeColors.textMuted }]}>Display Name</Text>
              <TextInput
                style={[styles.textInput, { color: themeColors.text, borderColor: themeColors.border }]}
                value={editName}
                onChangeText={setEditName}
              />

              <Text style={[styles.fieldLabel, { color: themeColors.textMuted, marginTop: 20 }]}>Velocity Tuning</Text>
              {renderPlusMinus("Rhythm Factor", editRhythm, setEditRhythm)}
              {renderPlusMinus("Melody Factor", editMelody, setEditMelody)}

              <Text style={[styles.fieldLabel, { color: themeColors.textMuted, marginTop: 20 }]}>Pedal Profile</Text>
              <View style={styles.pedalRow}>
                {['light', 'medium', 'full'].map(p => (
                  <TouchableOpacity 
                    key={p}
                    style={[
                      styles.pedalBtn, 
                      { borderColor: themeColors.border },
                      editPedal === p && { backgroundColor: themeColors.accent, borderColor: themeColors.accent }
                    ]}
                    onPress={() => setEditPedal(p)}
                  >
                    <Text style={[styles.pedalBtnText, { color: themeColors.text }, editPedal === p && { color: '#fff' }]}>
                      {p.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={[styles.fieldLabel, { color: themeColors.textMuted, marginTop: 20 }]}>Comments / Notes</Text>
              <TextInput
                style={[styles.textArea, { color: themeColors.text, borderColor: themeColors.border }]}
                value={editComments}
                onChangeText={setEditComments}
                multiline
                numberOfLines={3}
              />

              <TouchableOpacity 
                style={[styles.saveBtn, { backgroundColor: themeColors.accent }]}
                onPress={handleSaveSettings}
                disabled={isSavingSettings}
              >
                {isSavingSettings ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Apply & Re-Clean</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Library MIDI Picker Modal */}
      <Modal visible={showMidiPicker} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: themeColors.surface, height: '70%' }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: themeColors.text }]}>Select MIDI from Library</Text>
              <TouchableOpacity onPress={() => setShowMidiPicker(false)}>
                <Ionicons name="close" size={24} color={themeColors.text} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={midiFiles}
              keyExtractor={item => item.name}
              renderItem={({ item }) => (
                <TouchableOpacity 
                  style={[styles.libraryItem, { backgroundColor: themeColors.background, borderColor: themeColors.border }]}
                  onPress={() => handleSelectMidi(item.name)}
                >
                  <Ionicons name="musical-notes-outline" size={20} color={themeColors.accent} />
                  <Text style={[styles.jobName, { color: themeColors.text, marginLeft: 10, flex: 1 }]} numberOfLines={1}>
                    {item.name}
                  </Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>

      {/* Library Audio Picker Modal */}
      <Modal visible={showAudioPicker} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: themeColors.surface, height: '70%' }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: themeColors.text }]}>Select Audio from Library</Text>
              <TouchableOpacity onPress={() => setShowAudioPicker(false)}>
                <Ionicons name="close" size={24} color={themeColors.text} />
              </TouchableOpacity>
            </View>
            <Text style={{ fontSize: 11, color: themeColors.textMuted, marginBottom: 15, textAlign: 'center' }}>
              Select a track to use its accompaniment (Vocals/Band) with your current MIDI.
            </Text>
            <FlatList
              data={library.filter(j => j.status === 'completed' && j.job_id !== jobId)}
              keyExtractor={item => item.job_id}
              renderItem={({ item }) => (
                <TouchableOpacity 
                  style={[styles.libraryItem, { backgroundColor: themeColors.background, borderColor: themeColors.border }]}
                  onPress={() => handleSelectAudio(item.job_id)}
                >
                  <Ionicons name="mic-outline" size={20} color={themeColors.accent} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Text style={[styles.jobName, { color: themeColors.text }]} numberOfLines={1}>
                        {item.original_name}
                      </Text>
                      <Text style={{ color: themeColors.textMuted, fontSize: 10, marginLeft: 5 }}>#{item.job_id.substring(0, 4)}</Text>
                    </View>
                    {renderTags(item)}
                  </View>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <Text style={[styles.emptyText, { color: themeColors.textMuted }]}>No other processed songs available.</Text>
              }
            />
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 40 },
  content: { padding: 20, alignItems: 'center' },
  title: { fontSize: 24, fontWeight: '700' },
  sectionTitle: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, paddingHorizontal: 20, marginTop: 10 },
  description: { fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 30 },
  btn: {
    paddingHorizontal: 40, paddingVertical: 15, borderRadius: 30, width: '100%', alignItems: 'center',
    elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4
  },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  statusBox: { padding: 40, alignItems: 'center' },
  statusTitle: { fontSize: 18, fontWeight: '600', marginTop: 20 },
  progressText: { fontSize: 16, marginTop: 5 },
  controls: { width: '100%', marginTop: 20 },
  card: { width: '100%', padding: 20, borderRadius: 15, elevation: 2 },
  cardTitle: { fontSize: 16, fontWeight: '700', marginBottom: 20, textAlign: 'center' },
  row: { flexDirection: 'row', justifyContent: 'center', marginBottom: 30 },
  playBtn: { width: 80, height: 80, borderRadius: 40, justifyContent: 'center', alignItems: 'center', elevation: 5 },
  syncBox: { marginTop: 10 },
  label: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  subLabel: { fontSize: 12, textAlign: 'center', marginBottom: 10 },
  commentNote: { fontSize: 11, fontStyle: 'italic', marginTop: 15, textAlign: 'center' },
  libraryItem: { flexDirection: 'row', alignItems: 'center', padding: 15, borderRadius: 12, marginBottom: 10, borderWidth: 1 },
  jobName: { fontSize: 16, fontWeight: '600' },
  jobDate: { fontSize: 12, marginTop: 2 },
  emptyText: { textAlign: 'center', marginTop: 40, fontSize: 14 },
  
  fineTuneRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 5 },
  miniPlusMinusBtn: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },

  previewBtn: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  previewBtnText: { fontSize: 13, fontWeight: '700' },

  // Modal Styles
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { borderTopLeftRadius: 25, borderTopRightRadius: 25, padding: 25, maxHeight: '80%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 20, fontWeight: '700' },
  fieldLabel: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginBottom: 8 },
  textInput: { borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 16 },
  textArea: { borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 14, height: 80, textAlignVertical: 'top' },
  tuningRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  tuningLabel: { fontSize: 14, fontWeight: '500' },
  plusMinusBox: { flexDirection: 'row', alignItems: 'center', gap: 15 },
  plusMinusBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.05)', justifyContent: 'center', alignItems: 'center' },
  plusMinusVal: { fontSize: 16, fontWeight: '700', width: 50, textAlign: 'center' },
  pedalRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  pedalBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1, alignItems: 'center' },
  pedalBtnText: { fontSize: 12, fontWeight: '600' },
  saveBtn: { marginTop: 30, paddingVertical: 15, borderRadius: 10, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  hybridBtn: { 
    marginTop: 20, 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'center', 
    gap: 8, 
    paddingVertical: 10, 
    borderRadius: 8, 
    borderWidth: 1,
    borderStyle: 'dashed'
  },
  hybridBtnText: { fontSize: 13, fontWeight: '600' },
  
  // Workstation Tab Styles
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, height: 50 },
  tabItem: { flex: 1, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 6 },
  tabLabel: { fontSize: 11, fontWeight: '700' },

  floatingStatus: {
    position: 'absolute',
    top: 100,
    left: 20,
    right: 20,
    zIndex: 100,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderRadius: 12,
    borderWidth: 1,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },

  // Files-style Library UI
  searchBar: { padding: 12, borderRadius: 8, fontSize: 16, width: '100%' },
  fileItem: { flexDirection: 'row', padding: 14, paddingHorizontal: 18, alignItems: 'center', borderBottomWidth: 1 },
  selectionIndicator: { marginRight: 15 },
  fileInfo: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fileName: { fontSize: 15, fontWeight: '600', flex: 1, marginRight: 5 },
  fileMeta: { fontSize: 10, fontWeight: '700' },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  
  actionBar: { 
    flexDirection: 'row', 
    padding: 10, 
    alignItems: 'center', 
    position: 'absolute', 
    bottom: 30, 
    left: 20, 
    right: 20, 
    zIndex: 100, 
    elevation: 10, 
    borderRadius: 12,
    height: 70
  },
  actionCount: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    paddingHorizontal: 15, 
    borderRightWidth: 1, 
    borderRightColor: 'rgba(255,255,255,0.2)',
    flex: 1
  },
  actionCountText: { color: '#fff', fontWeight: '700', marginLeft: 10, fontSize: 16 },
  actionButtons: { paddingHorizontal: 10, gap: 15, alignItems: 'center' },
  barBtn: { alignItems: 'center', minWidth: 60 },
  barBtnText: { fontSize: 10, color: '#fff', fontWeight: '700', marginTop: 2 }
});
