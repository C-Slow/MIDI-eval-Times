import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  ActivityIndicator, 
  FlatList, 
  Alert, 
  ScrollView, 
  Dimensions,
  TextInput,
  InteractionManager
} from 'react-native';
import Slider from '@react-native-community/slider';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { Audio } from 'expo-av';
import { useStore } from '../store/useStore';
import { midiOrchestratorApi, pianoApi } from '../services/api';
import { Colors } from '../constants/Colors';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PIXELS_PER_SECOND = 40; // Timeline scale
const LANE_HEIGHT = 80;

export const MidiEditorScreen = () => {
  const theme = useStore(state => state.theme);
  const themeColors = Colors[theme];
  const isPianoConnected = useStore(state => state.isPianoConnected);
  const globalOffset = useStore(state => state.midiOrchestrateOffset);
  const setGlobalOffset = useStore(state => state.setMidiOrchestrateOffset);
  const setSystemBusy = useStore(state => state.setSystemBusy);

  // Screen Stages: 'list' | 'config' | 'visualizer'
  const [stage, setStage] = useState<'list' | 'config' | 'visualizer'>('list');
  const [loading, setLoading] = useState(false);
  const [jobs, setJobs] = useState<any[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  
  // Track configuration state
  const [pianoTracks, setPianoTracks] = useState<Set<number>>(new Set());
  const [speakerTracks, setSpeakerTracks] = useState<Set<number>>(new Set());
  const [pedalPreset, setPedalPreset] = useState<'light' | 'medium' | 'full'>('light');
  const [rhythmFactor, setRhythmFactor] = useState(1.0);
  const [melodyFactor, setMelodyFactor] = useState(1.0);

  // Playback / Visualizer State
  const [notes, setNotes] = useState<Record<string, any[]>>({});
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackPos, setPlaybackPos] = useState(0); // in ms
  const [playbackDuration, setPlaybackDuration] = useState(0); // in ms
  const soundRef = useRef<Audio.Sound | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);
  const playbackTimerRef = useRef<any>(null);
  const isSeekingRef = useRef(false);

  // Preview State
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const previewSoundRef = useRef<Audio.Sound | null>(null);

  // Selected job details
  const currentJob = useMemo(() => {
    return jobs.find(j => j.job_id === selectedJobId) || null;
  }, [jobs, selectedJobId]);

  // Load jobs list
  const fetchJobs = async () => {
    try {
      const data = await midiOrchestratorApi.listJobs();
      setJobs(data);
    } catch (e) {
      console.error('Failed to load midi jobs', e);
    }
  };

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      setLoading(true);
      fetchJobs().finally(() => setLoading(false));
    });
    return () => {
      task.cancel();
      stopPlayback();
      stopPreview();
    };
  }, []);

  // Poll job status if any is processing
  useEffect(() => {
    const hasProcessing = jobs.some(j => j.status === 'processing' || j.status === 'synthesizing');
    let timer: any;
    if (hasProcessing) {
      timer = setInterval(fetchJobs, 2000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [jobs]);

  // Handle MIDI Upload
  const handleUpload = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['audio/midi', 'audio/x-midi', 'audio/mid', '*/*'],
        copyToCacheDirectory: true
      });
      if (res.canceled || !res.assets || res.assets.length === 0) return;

      const asset = res.assets[0];
      if (!asset.name.toLowerCase().endsWith('.mid') && !asset.name.toLowerCase().endsWith('.midi')) {
        Alert.alert('Invalid File', 'Please choose a standard MIDI (.mid or .midi) file.');
        return;
      }

      setLoading(true);
      const data = await midiOrchestratorApi.upload(asset.uri, asset.name);
      await fetchJobs();
      Alert.alert('Upload Success', 'MIDI track extracted. Select it to configure track allocation.');
      
      // Auto-open config stage for the newly uploaded job
      setSelectedJobId(data.job_id);
      setPianoTracks(new Set());
      setSpeakerTracks(new Set());
      setStage('config');
    } catch (e: any) {
      console.error(e);
      Alert.alert('Upload Failed', e.message || 'Could not upload MIDI file.');
    } finally {
      setLoading(false);
    }
  };

  // Open job in proper stage
  const handleJobSelect = (job: any) => {
    setSelectedJobId(job.job_id);
    if (job.status === 'completed') {
      openVisualizer(job.job_id);
    } else if (job.status === 'uploaded' || job.status === 'failed') {
      setPianoTracks(new Set(job.piano_tracks || []));
      setSpeakerTracks(new Set(job.speaker_tracks || []));
      setPedalPreset(job.pedal_preset || 'light');
      setRhythmFactor(job.rhythm_factor ?? 1.0);
      setMelodyFactor(job.melody_factor ?? 1.0);
      setStage('config');
    } else {
      Alert.alert('Processing', 'This file is currently being processed. Please wait...');
    }
  };

  // Delete Job
  const handleDeleteJob = async (jobId: string) => {
    Alert.alert(
      'Delete Job',
      'Are you sure you want to delete this MIDI Orchestration job?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive',
          onPress: async () => {
            try {
              setLoading(true);
              await midiOrchestratorApi.deleteJob(jobId);
              await fetchJobs();
            } catch (e) {
              console.error(e);
            } finally {
              setLoading(false);
            }
          }
        }
      ]
    );
  };

  // Toggle track role
  const handleTrackRoleToggle = (trackIndex: number, role: 'piano' | 'speakers' | 'mute') => {
    setPianoTracks(prev => {
      const next = new Set(prev);
      if (role === 'piano') next.add(trackIndex);
      else next.delete(trackIndex);
      return next;
    });
    setSpeakerTracks(prev => {
      const next = new Set(prev);
      if (role === 'speakers') next.add(trackIndex);
      else next.delete(trackIndex);
      return next;
    });
  };

  const stopPreview = async () => {
    if (previewSoundRef.current) {
      try {
        await previewSoundRef.current.stopAsync();
        await previewSoundRef.current.unloadAsync();
      } catch (e) {}
      previewSoundRef.current = null;
    }
    setIsPreviewPlaying(false);
    setIsPreviewLoading(false);
  };

  const handleTogglePreview = async () => {
    if (!selectedJobId) return;
    if (pianoTracks.size === 0 && speakerTracks.size === 0) {
      Alert.alert('No Tracks Selected', 'Choose at least one track to preview.');
      return;
    }

    if (isPreviewPlaying) {
      await stopPreview();
      return;
    }

    setIsPreviewLoading(true);
    try {
      if (previewSoundRef.current) {
        await previewSoundRef.current.unloadAsync();
      }

      const url = midiOrchestratorApi.getPreviewUrl(
        selectedJobId, 
        Array.from(pianoTracks), 
        Array.from(speakerTracks)
      );

      const { sound } = await Audio.Sound.createAsync(
        { uri: url },
        { shouldPlay: true },
        (status: any) => {
          if (status.didJustFinish) {
            stopPreview();
          }
        }
      );

      previewSoundRef.current = sound;
      setIsPreviewPlaying(true);
    } catch (e: any) {
      console.error(e);
      Alert.alert('Preview Failed', 'Could not generate or play local audio preview.');
    } finally {
      setIsPreviewLoading(false);
    }
  };

  // Run Backend Split & Synthesize Process
  const handleProcess = async () => {
    if (!selectedJobId) return;
    if (pianoTracks.size === 0 && speakerTracks.size === 0) {
      Alert.alert('No Tracks Selected', 'Choose at least one track for Piano or Speakers.');
      return;
    }

    try {
      setLoading(true);
      await midiOrchestratorApi.process(
        selectedJobId,
        Array.from(pianoTracks),
        Array.from(speakerTracks),
        pedalPreset,
        rhythmFactor,
        melodyFactor
      );
      await fetchJobs();
      setStage('list');
      Alert.alert('Processing Started', 'Extracting piano keys and generating backing strings. Monitor progress in the jobs list.');
    } catch (e: any) {
      console.error(e);
      Alert.alert('Processing Failed', e.message || 'Could not start processing.');
    } finally {
      setLoading(false);
    }
  };

  // Open Visualizer/Player
  const openVisualizer = async (jobId: string) => {
    setLoading(true);
    try {
      // 1. Fetch note events for the lanes
      const noteData = await midiOrchestratorApi.getNotes(jobId);
      setNotes(noteData);

      // 2. Setup Expo Audio Sound for backing track
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
      }
      const url = midiOrchestratorApi.getBackingAudioUrl(jobId);
      
      const { sound } = await Audio.Sound.createAsync(
        { uri: url },
        { shouldPlay: false, progressUpdateIntervalMillis: 100 },
        onPlaybackStatusUpdate
      );
      soundRef.current = sound;

      setStage('visualizer');
    } catch (e: any) {
      console.error(e);
      Alert.alert('Visualizer Error', 'Failed to load visual note events or backing audio.');
    } finally {
      setLoading(false);
    }
  };

  // Sound Playback Updates
  const onPlaybackStatusUpdate = (status: any) => {
    if (status.isLoaded) {
      setPlaybackPos(status.positionMillis);
      setPlaybackDuration(status.durationMillis || 0);

      // Scroll timeline to playhead
      if (status.isPlaying && !isSeekingRef.current) {
        const sec = status.positionMillis / 1000;
        const scrollX = Math.max(0, (sec * PIXELS_PER_SECOND) - (SCREEN_WIDTH / 3));
        scrollRef.current?.scrollTo({ x: scrollX, animated: false });
      }

      if (status.didJustFinish) {
        stopPlayback();
      }
    }
  };

  // Sync Playback Controllers
  const startPlayback = async () => {
    if (!soundRef.current || !selectedJobId) return;

    try {
      setSystemBusy(true);
      setIsPlaying(true);

      // Apply Global Delay setting
      // positive = delay MIDI (Audio plays first)
      // negative = delay Audio (MIDI plays first)
      if (globalOffset >= 0) {
        // Play local backing audio immediately
        await soundRef.current.playAsync();
        
        if (globalOffset > 0 && isPianoConnected) {
          playbackTimerRef.current = setTimeout(async () => {
            try {
              await midiOrchestratorApi.playMidi(selectedJobId);
            } catch (e) {
              console.error('Disklavier play failed', e);
            }
          }, globalOffset);
        } else if (isPianoConnected) {
          await midiOrchestratorApi.playMidi(selectedJobId);
        }
      } else {
        // Play disklavier MIDI immediately
        if (isPianoConnected) {
          await midiOrchestratorApi.playMidi(selectedJobId);
        }
        
        // Delay backing audio
        playbackTimerRef.current = setTimeout(async () => {
          if (soundRef.current) {
            await soundRef.current.playAsync();
          }
        }, Math.abs(globalOffset));
      }
    } catch (e) {
      console.error(e);
      setIsPlaying(false);
      setSystemBusy(false);
      Alert.alert('Playback Error', 'Failed to start synchronized playback.');
    }
  };

  const pausePlayback = async () => {
    if (playbackTimerRef.current) {
      clearTimeout(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
    if (soundRef.current) {
      await soundRef.current.pauseAsync();
    }
    await pianoApi.stop();
    setIsPlaying(false);
    setSystemBusy(false);
  };

  const stopPlayback = async () => {
    if (playbackTimerRef.current) {
      clearTimeout(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
    if (soundRef.current) {
      try {
        await soundRef.current.stopAsync();
      } catch (e) {}
    }
    await pianoApi.stop();
    setIsPlaying(false);
    setSystemBusy(false);
    setPlaybackPos(0);
    scrollRef.current?.scrollTo({ x: 0, animated: true });
  };

  // Format Duration helper
  const formatTime = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const secs = s % 60;
    return `${m}:${secs < 10 ? '0' : ''}${secs}`;
  };

  // Color picker for tracks/visualizer
  const getTrackColor = (trackIndex: number, isPiano: boolean, isSpeaker: boolean) => {
    if (isPiano) return themeColors.accent; // Vibrant Blue/Cyan
    if (isSpeaker) return '#a29bfe'; // Light purple for strings/speakers
    return themeColors.textMuted;
  };

  // visualizer math functions
  const getLanesData = useMemo(() => {
    if (!currentJob || !notes) return [];
    
    // Build lanes only for tracks containing notes
    return currentJob.tracks.filter((t: any) => {
      const trackNotes = notes[String(t.index)] || [];
      return trackNotes.length > 0;
    }).map((track: any) => {
      const trackNotes = notes[String(track.index)] || [];
      const pitches = trackNotes.map(n => n.pitch);
      const minPitch = pitches.length > 0 ? Math.min(...pitches) : 40;
      const maxPitch = pitches.length > 0 ? Math.max(...pitches) : 80;
      const pitchRange = Math.max(12, maxPitch - minPitch); // avoid division by zero, min 1 octave height scale
      
      return {
        ...track,
        notes: trackNotes,
        minPitch,
        maxPitch,
        pitchRange
      };
    });
  }, [currentJob, notes]);

  // Timeline render item notes
  const renderVisualizerTimeline = () => {
    const durationSec = playbackDuration / 1000 || currentJob?.tracks[0]?.duration || 180;
    const timelineWidth = durationSec * PIXELS_PER_SECOND;
    const totalHeight = getLanesData.length * LANE_HEIGHT;

    return (
      <ScrollView 
        style={[styles.verticalLanesScrollView, { backgroundColor: themeColors.background }]}
        contentContainerStyle={{ flexGrow: 1 }}
      >
        <View style={styles.visualizerContainer}>
          {/* Left Track Names Sidebar */}
          <View style={[styles.sidebar, { borderRightColor: themeColors.border, backgroundColor: themeColors.surface, height: totalHeight }]}>
            {getLanesData.map((lane: any) => {
              const isPiano = currentJob?.piano_tracks?.includes(lane.index);
              const isSpeaker = currentJob?.speaker_tracks?.includes(lane.index);
              
              return (
                <View key={lane.index} style={[styles.sidebarLane, { height: LANE_HEIGHT, borderBottomColor: themeColors.border }]}>
                  <Text style={[styles.sidebarLaneTitle, { color: themeColors.text }]} numberOfLines={1}>
                    {lane.name}
                  </Text>
                  <View style={styles.sidebarBadges}>
                    {isPiano && (
                      <View style={[styles.badge, { backgroundColor: themeColors.accentLight }]}>
                        <Ionicons name="musical-notes" size={10} color={themeColors.accent} />
                        <Text style={[styles.badgeText, { color: themeColors.accent }]}>Piano</Text>
                      </View>
                    )}
                    {isSpeaker && (
                      <View style={[styles.badge, { backgroundColor: 'rgba(162, 155, 254, 0.2)' }]}>
                        <Ionicons name="volume-high" size={10} color="#a29bfe" />
                        <Text style={[styles.badgeText, { color: '#a29bfe' }]}>Speakers</Text>
                      </View>
                    )}
                    {!isPiano && !isSpeaker && (
                      <View style={[styles.badge, { backgroundColor: themeColors.surfaceSecondary }]}>
                        <Text style={[styles.badgeText, { color: themeColors.textMuted }]}>Muted</Text>
                      </View>
                    )}
                  </View>
                </View>
              );
            })}
          </View>

          {/* Scrollable Lanes Grid */}
          <ScrollView 
            horizontal 
            ref={scrollRef}
            showsHorizontalScrollIndicator={true}
            style={[styles.lanesScrollView, { backgroundColor: themeColors.background, height: totalHeight }]}
          >
            <View style={{ width: timelineWidth, height: totalHeight }}>
            {getLanesData.map((lane: any, laneIdx: number) => {
              const isPiano = currentJob?.piano_tracks?.includes(lane.index);
              const isSpeaker = currentJob?.speaker_tracks?.includes(lane.index);
              const color = getTrackColor(lane.index, isPiano, isSpeaker);

              return (
                <View 
                  key={lane.index} 
                  style={[
                    styles.laneTimeline, 
                    { 
                      height: LANE_HEIGHT, 
                      top: laneIdx * LANE_HEIGHT, 
                      borderBottomColor: themeColors.border 
                    }
                  ]}
                >
                  {/* Grid Lines per second */}
                  {Array.from({ length: Math.ceil(durationSec / 5) }).map((_, i) => (
                    <View 
                      key={i} 
                      style={[
                        styles.gridLine, 
                        { 
                          left: i * 5 * PIXELS_PER_SECOND, 
                          borderColor: themeColors.border, 
                          height: LANE_HEIGHT 
                        }
                      ]} 
                    />
                  ))}

                  {/* Render Notes */}
                  {lane.notes.map((note: any, noteIdx: number) => {
                    const noteWidth = Math.max(2, (note.end - note.start) * PIXELS_PER_SECOND);
                    const noteLeft = note.start * PIXELS_PER_SECOND;
                    
                    // Pitch scaling: higher pitch = closer to top of the lane
                    const verticalPadding = 8;
                    const usableLaneHeight = LANE_HEIGHT - (verticalPadding * 2);
                    const normalizedPitch = (note.pitch - lane.minPitch) / lane.pitchRange;
                    const noteTop = verticalPadding + (usableLaneHeight * (1 - normalizedPitch));

                    return (
                      <View
                        key={noteIdx}
                        style={[
                          styles.note,
                          {
                            left: noteLeft,
                            width: noteWidth,
                            top: noteTop,
                            height: 4,
                            backgroundColor: color,
                            shadowColor: color,
                            shadowRadius: isPlaying ? 2 : 0,
                            shadowOpacity: isPlaying ? 0.5 : 0
                          }
                        ]}
                      />
                    );
                  })}
                </View>
              );
            })}

            {/* Glowing Vertical Playhead */}
            <View 
              style={[
                styles.playheadLine, 
                { 
                  left: (playbackPos / 1000) * PIXELS_PER_SECOND, 
                  height: totalHeight,
                  backgroundColor: themeColors.accent
                }
              ]} 
            />
          </View>
        </ScrollView>
      </View>
      </ScrollView>
    );
  };

  // Back visualizer handler
  const handleExitVisualizer = () => {
    stopPlayback();
    setStage('list');
  };

  // Exit config
  const handleExitConfig = () => {
    stopPreview();
    setStage('list');
  };

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      
      {/* 1. LIST STAGE */}
      {stage === 'list' && (
        <View style={styles.listContainer}>
          <View style={styles.header}>
            <Text style={[styles.headerTitle, { color: themeColors.text }]}>MIDI Orchestrator</Text>
            <TouchableOpacity 
              style={[styles.uploadBtn, { backgroundColor: themeColors.accent }]} 
              onPress={handleUpload}
              disabled={loading}
            >
              <Ionicons name="cloud-upload" size={16} color="#fff" style={{ marginRight: 6 }} />
              <Text style={styles.uploadBtnText}>Upload MIDI</Text>
            </TouchableOpacity>
          </View>

          {loading ? (
            <ActivityIndicator size="large" color={themeColors.accent} style={{ marginTop: 50 }} />
          ) : (
            <FlatList
              data={jobs}
              keyExtractor={item => item.job_id}
              contentContainerStyle={{ padding: 15 }}
              renderItem={({ item }) => (
                <TouchableOpacity 
                  style={[styles.jobCard, { backgroundColor: themeColors.surface, borderColor: themeColors.border }]}
                  onPress={() => handleJobSelect(item)}
                >
                  <View style={styles.jobInfo}>
                    <Text style={[styles.jobFilename, { color: themeColors.text }]} numberOfLines={1}>
                      {item.filename}
                    </Text>
                    
                    <Text style={[styles.jobMeta, { color: themeColors.textMuted }]}>
                      {new Date(item.timestamp * 1000).toLocaleDateString()} • {item.tracks?.length || 0} tracks
                    </Text>

                    {/* Progress details */}
                    {(item.status === 'processing' || item.status === 'synthesizing') && (
                      <View style={styles.progressContainer}>
                        <View style={[styles.progressBarBg, { backgroundColor: themeColors.surfaceSecondary }]}>
                          <View style={[styles.progressBarFill, { width: `${item.progress}%`, backgroundColor: themeColors.accent }]} />
                        </View>
                        <Text style={[styles.progressText, { color: themeColors.textMuted }]}>
                          {item.status === 'synthesizing' ? 'Rendering Strings...' : `Processing ${item.progress}%`}
                        </Text>
                      </View>
                    )}

                    {/* Status Badges */}
                    {item.status === 'completed' && (
                      <View style={[styles.statusBadge, { backgroundColor: 'rgba(46, 204, 113, 0.15)' }]}>
                        <Ionicons name="checkmark-circle" size={12} color="#2ecc71" />
                        <Text style={[styles.statusText, { color: '#2ecc71' }]}>Ready Playback</Text>
                      </View>
                    )}
                    {item.status === 'failed' && (
                      <View style={[styles.statusBadge, { backgroundColor: 'rgba(231, 76, 60, 0.15)' }]}>
                        <Ionicons name="alert-circle" size={12} color="#e74c3c" />
                        <Text style={[styles.statusText, { color: '#e74c3c' }]}>Failed: {item.error}</Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.cardActions}>
                    <TouchableOpacity 
                      style={styles.deleteCardBtn}
                      onPress={() => handleDeleteJob(item.job_id)}
                    >
                      <Ionicons name="trash-outline" size={20} color={themeColors.textMuted} />
                    </TouchableOpacity>
                    <Ionicons name="chevron-forward" size={20} color={themeColors.accent} />
                  </View>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <View style={{ alignItems: 'center', marginTop: 80 }}>
                  <Ionicons name="musical-notes-outline" size={60} color={themeColors.textMuted} style={{ marginBottom: 15 }} />
                  <Text style={[styles.emptyText, { color: themeColors.textMuted }]}>No MIDI Orchestrator jobs found.</Text>
                  <Text style={[styles.emptySubtext, { color: themeColors.textMuted }]}>Upload a multitrack MIDI file to get started.</Text>
                </View>
              }
            />
          )}
        </View>
      )}

      {/* 2. CONFIGURATION STAGE */}
      {stage === 'config' && currentJob && (
        <View style={styles.configContainer}>
          <View style={[styles.configHeader, { borderBottomColor: themeColors.border }]}>
            <TouchableOpacity onPress={handleExitConfig}>
              <Ionicons name="arrow-back" size={24} color={themeColors.text} />
            </TouchableOpacity>
            <Text style={[styles.configTitle, { color: themeColors.text }]} numberOfLines={1}>
              Allocate Instruments
            </Text>
            <View style={{ width: 24 }} />
          </View>

          <ScrollView contentContainerStyle={{ padding: 15, paddingBottom: 50 }}>
            <Text style={[styles.sectionSubtitle, { color: themeColors.text }]}>
              File: {currentJob.filename}
            </Text>

            {/* List of Tracks */}
            <Text style={[styles.sectionHeaderTitle, { color: themeColors.textMuted, marginTop: 15 }]}>Tracks Allocation</Text>
            {currentJob.tracks.map((track: any) => {
              const isPiano = pianoTracks.has(track.index);
              const isSpeaker = speakerTracks.has(track.index);
              const isMute = !isPiano && !isSpeaker;

              return (
                <View key={track.index} style={[styles.trackCard, { backgroundColor: themeColors.surface, borderColor: themeColors.border }]}>
                  <View style={styles.trackInfoText}>
                    <Text style={[styles.trackName, { color: themeColors.text }]}>
                      {track.name}
                    </Text>
                    <Text style={[styles.trackInstrument, { color: themeColors.textMuted }]}>
                      {track.instrument_name} • {track.note_count} notes
                    </Text>
                  </View>

                  <View style={styles.roleToggles}>
                    {/* Piano Button */}
                    <TouchableOpacity 
                      style={[
                        styles.toggleBtn, 
                        isPiano && { backgroundColor: themeColors.accentLight, borderColor: themeColors.accent }
                      ]}
                      onPress={() => handleTrackRoleToggle(track.index, 'piano')}
                    >
                      <Ionicons name="musical-notes" size={16} color={isPiano ? themeColors.accent : themeColors.textMuted} />
                      <Text style={[styles.toggleText, { color: isPiano ? themeColors.accent : themeColors.textMuted }]}>Piano</Text>
                    </TouchableOpacity>

                    {/* Speaker Button */}
                    <TouchableOpacity 
                      style={[
                        styles.toggleBtn, 
                        isSpeaker && { backgroundColor: 'rgba(162, 155, 254, 0.15)', borderColor: '#a29bfe' }
                      ]}
                      onPress={() => handleTrackRoleToggle(track.index, 'speakers')}
                    >
                      <Ionicons name="volume-high" size={16} color={isSpeaker ? '#a29bfe' : themeColors.textMuted} />
                      <Text style={[styles.toggleText, { color: isSpeaker ? '#a29bfe' : themeColors.textMuted }]}>Speakers</Text>
                    </TouchableOpacity>

                    {/* Mute Button */}
                    <TouchableOpacity 
                      style={[
                        styles.toggleBtn, 
                        isMute && { backgroundColor: themeColors.surfaceSecondary, borderColor: themeColors.border }
                      ]}
                      onPress={() => handleTrackRoleToggle(track.index, 'mute')}
                    >
                      <Ionicons name="volume-mute" size={16} color={isMute ? themeColors.text : themeColors.textMuted} />
                      <Text style={[styles.toggleText, { color: isMute ? themeColors.text : themeColors.textMuted }]}>Mute</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}

            {/* Cleaning Settings */}
            <Text style={[styles.sectionHeaderTitle, { color: themeColors.textMuted, marginTop: 25 }]}>Piano Clean Settings</Text>
            
            <View style={[styles.settingsPanel, { backgroundColor: themeColors.surface, borderColor: themeColors.border }]}>
              {/* Presets */}
              <Text style={[styles.settingLabel, { color: themeColors.text }]}>Pedal Preset</Text>
              <View style={styles.presetGroup}>
                {['light', 'medium', 'full'].map(preset => (
                  <TouchableOpacity 
                    key={preset}
                    style={[
                      styles.presetBtn, 
                      { borderColor: themeColors.border },
                      pedalPreset === preset && { backgroundColor: themeColors.accent, borderColor: themeColors.accent }
                    ]}
                    onPress={() => setPedalPreset(preset as any)}
                  >
                    <Text style={[styles.presetText, { color: pedalPreset === preset ? '#fff' : themeColors.text }]}>
                      {preset.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Rhythm Slider */}
              <View style={styles.sliderRow}>
                <Text style={[styles.settingLabel, { color: themeColors.text }]}>
                  Rhythm Velocity Factor ({rhythmFactor.toFixed(2)}x)
                </Text>
                <Slider
                  style={{ width: '100%', height: 40 }}
                  minimumValue={0.2}
                  maximumValue={2.0}
                  value={rhythmFactor}
                  onValueChange={setRhythmFactor}
                  minimumTrackTintColor={themeColors.accent}
                  maximumTrackTintColor={themeColors.border}
                  thumbTintColor={themeColors.accent}
                />
              </View>

              {/* Melody Slider */}
              <View style={styles.sliderRow}>
                <Text style={[styles.settingLabel, { color: themeColors.text }]}>
                  Melody Velocity Factor ({melodyFactor.toFixed(2)}x)
                </Text>
                <Slider
                  style={{ width: '100%', height: 40 }}
                  minimumValue={0.2}
                  maximumValue={2.0}
                  value={melodyFactor}
                  onValueChange={setMelodyFactor}
                  minimumTrackTintColor={themeColors.accent}
                  maximumTrackTintColor={themeColors.border}
                  thumbTintColor={themeColors.accent}
                />
              </View>
            </View>

            <View style={styles.actionButtonsRow}>
              <TouchableOpacity 
                style={[styles.previewBtn, { borderColor: themeColors.accent, borderWidth: 1.5 }]}
                onPress={handleTogglePreview}
                disabled={loading || isPreviewLoading}
              >
                {isPreviewLoading ? (
                  <ActivityIndicator color={themeColors.accent} />
                ) : (
                  <>
                    <Ionicons 
                      name={isPreviewPlaying ? "stop" : "volume-high"} 
                      size={20} 
                      color={isPreviewPlaying ? "#ff5252" : themeColors.accent} 
                      style={{ marginRight: 8 }} 
                    />
                    <Text style={[styles.previewBtnText, { color: isPreviewPlaying ? "#ff5252" : themeColors.accent }]}>
                      {isPreviewPlaying ? "Stop Preview" : "Preview Mix"}
                    </Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity 
                style={[styles.processBtn, { backgroundColor: themeColors.accent, flex: 1, marginLeft: 12, marginTop: 0 }]}
                onPress={handleProcess}
                disabled={loading || isPreviewPlaying}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="color-wand" size={20} color="#fff" style={{ marginRight: 8 }} />
                    <Text style={styles.processBtnText}>Process & Synthesize</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

          </ScrollView>
        </View>
      )}

      {/* 3. VISUALIZER & PLAYBACK STAGE */}
      {stage === 'visualizer' && currentJob && (
        <View style={styles.visualizerStage}>
          {/* Header */}
          <View style={[styles.visualizerHeader, { borderBottomColor: themeColors.border, backgroundColor: themeColors.surface }]}>
            <TouchableOpacity onPress={handleExitVisualizer}>
              <Ionicons name="arrow-back" size={24} color={themeColors.text} />
            </TouchableOpacity>
            <View style={{ flex: 1, marginLeft: 15 }}>
              <Text style={[styles.visualizerFilename, { color: themeColors.text }]} numberOfLines={1}>
                {currentJob.filename}
              </Text>
              <Text style={[styles.visualizerStateSub, { color: themeColors.textMuted }]}>
                {isPlaying ? 'Playing synced playback' : 'Playback stopped'}
              </Text>
            </View>
            
            {/* Sync Delay Controls */}
            <View style={styles.delayControls}>
              <Text style={[styles.delayLabel, { color: themeColors.textMuted }]}>Speaker Sync</Text>
              <View style={styles.delayButtonsRow}>
                <TouchableOpacity 
                  style={[styles.offsetBtn, { backgroundColor: themeColors.surfaceSecondary }]}
                  onPress={() => setGlobalOffset(globalOffset - 10)}
                >
                  <Text style={[styles.offsetBtnText, { color: themeColors.text }]}>-10ms</Text>
                </TouchableOpacity>
                <Text style={[styles.offsetValue, { color: themeColors.text, fontWeight: '700' }]}>
                  {globalOffset >= 0 ? `+${globalOffset}` : globalOffset}ms
                </Text>
                <TouchableOpacity 
                  style={[styles.offsetBtn, { backgroundColor: themeColors.surfaceSecondary }]}
                  onPress={() => setGlobalOffset(globalOffset + 10)}
                >
                  <Text style={[styles.offsetBtnText, { color: themeColors.text }]}>+10ms</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Timeline Visualizer lanes rendering */}
          {renderVisualizerTimeline()}

          {/* Synced Playback Controls Bar */}
          <View style={[styles.controlsBar, { backgroundColor: themeColors.surface, borderTopColor: themeColors.border }]}>
            {/* Time progress */}
            <View style={styles.timeRow}>
              <Text style={{ color: themeColors.text, fontSize: 12 }}>{formatTime(playbackPos)}</Text>
              <Text style={{ color: themeColors.textMuted, fontSize: 12 }}>{formatTime(playbackDuration)}</Text>
            </View>

            {/* Main Buttons */}
            <View style={styles.buttonsRow}>
              <TouchableOpacity 
                style={[styles.playbackStopBtn, { backgroundColor: themeColors.surfaceSecondary }]}
                onPress={stopPlayback}
              >
                <Ionicons name="square" size={24} color={themeColors.text} />
              </TouchableOpacity>

              <TouchableOpacity 
                style={[styles.playbackPlayBtn, { backgroundColor: themeColors.accent }]}
                onPress={isPlaying ? pausePlayback : startPlayback}
              >
                <Ionicons name={isPlaying ? "pause" : "play"} size={36} color="#fff" />
              </TouchableOpacity>
              
              <View style={{ width: 48 }} /> {/* spacer */}
            </View>
          </View>

        </View>
      )}

    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContainer: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
  },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
  },
  uploadBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  jobCard: {
    flexDirection: 'row',
    padding: 15,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
    alignItems: 'center',
  },
  jobInfo: {
    flex: 1,
  },
  jobFilename: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  jobMeta: {
    fontSize: 12,
    marginBottom: 8,
  },
  progressContainer: {
    marginTop: 5,
  },
  progressBarBg: {
    height: 4,
    width: '100%',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 4,
  },
  progressBarFill: {
    height: '100%',
  },
  progressText: {
    fontSize: 11,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: 4,
    alignSelf: 'flex-start',
    gap: 4,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
  },
  deleteCardBtn: {
    padding: 5,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 6,
  },
  emptySubtext: {
    fontSize: 12,
  },

  // CONFIGURATION STAGE
  configContainer: {
    flex: 1,
  },
  configHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
  },
  configTitle: {
    fontSize: 18,
    fontWeight: '700',
    maxWidth: SCREEN_WIDTH * 0.6,
  },
  sectionSubtitle: {
    fontSize: 13,
    fontWeight: '600',
    opacity: 0.8,
  },
  sectionHeaderTitle: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  trackCard: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
  },
  trackInfoText: {
    marginBottom: 8,
  },
  trackName: {
    fontSize: 15,
    fontWeight: '600',
  },
  trackInstrument: {
    fontSize: 11,
  },
  roleToggles: {
    flexDirection: 'row',
    gap: 6,
  },
  toggleBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'transparent',
    gap: 4,
  },
  toggleText: {
    fontSize: 11,
    fontWeight: '600',
  },
  settingsPanel: {
    padding: 15,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 15,
  },
  settingLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  presetGroup: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 15,
  },
  presetBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
  },
  presetText: {
    fontSize: 11,
    fontWeight: '700',
  },
  sliderRow: {
    marginBottom: 15,
  },
  actionButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 20,
  },
  previewBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: 'transparent',
  },
  previewBtnText: {
    fontSize: 15,
    fontWeight: '700',
  },
  processBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 10,
  },
  processBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },

  // VISUALIZER STAGE
  visualizerStage: {
    flex: 1,
  },
  visualizerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
  },
  visualizerFilename: {
    fontSize: 16,
    fontWeight: '700',
  },
  visualizerStateSub: {
    fontSize: 11,
    marginTop: 2,
  },
  delayControls: {
    alignItems: 'flex-end',
  },
  delayLabel: {
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 4,
  },
  delayButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  offsetBtn: {
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: 4,
  },
  offsetBtnText: {
    fontSize: 10,
    fontWeight: '700',
  },
  offsetValue: {
    fontSize: 11,
    minWidth: 40,
    textAlign: 'center',
  },

  // Timeline UI Layout
  visualizerContainer: {
    flex: 1,
    flexDirection: 'row',
  },
  sidebar: {
    width: 110,
    borderRightWidth: 1,
    zIndex: 10,
  },
  sidebarLane: {
    justifyContent: 'center',
    paddingHorizontal: 8,
    borderBottomWidth: 1,
  },
  sidebarLaneTitle: {
    fontSize: 11,
    fontWeight: '700',
  },
  sidebarBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 4,
    gap: 4,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2,
    paddingHorizontal: 4,
    borderRadius: 3,
    gap: 2,
  },
  badgeText: {
    fontSize: 8,
    fontWeight: '700',
  },
  verticalLanesScrollView: {
    flex: 1,
  },
  lanesScrollView: {
    flex: 1,
  },
  laneTimeline: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderBottomWidth: 1,
  },
  gridLine: {
    position: 'absolute',
    borderLeftWidth: 1,
    borderStyle: 'dashed',
    opacity: 0.15,
  },
  note: {
    position: 'absolute',
    borderRadius: 1.5,
  },
  playheadLine: {
    position: 'absolute',
    width: 1.5,
    top: 0,
    bottom: 0,
    zIndex: 5,
    shadowColor: '#fff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 3,
  },

  // Playback Control Bar
  controlsBar: {
    padding: 15,
    paddingBottom: 25,
    borderTopWidth: 1,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  buttonsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 30,
  },
  playbackPlayBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  playbackStopBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  }
});
