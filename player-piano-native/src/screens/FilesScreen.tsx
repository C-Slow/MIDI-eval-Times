import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl, Alert, Platform, Modal, ScrollView, Switch, InteractionManager } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { useStore } from '../store/useStore';
import { fileApi, pianoApi, processApi, playlistApi, settingsApi } from '../services/api';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { Colors } from '../constants/Colors';
import Slider from '@react-native-community/slider';
import { SongDetailsModal } from '../components/SongDetailsModal';

// Memoized individual file item to prevent massive re-renders of the whole list
const FileListItem = React.memo(({ item, isSelected, themeColors, playlists, onPlay, onSelect, onTempoPress }: any) => {
    const tempo = item.metadata?.tempo_factor || 1.0;
    const rhythmFactor = item.metadata?.rhythm_factor;
    const melodyFactor = item.metadata?.melody_factor;
    const durationSec = Math.floor(item.length || 0);
    const mins = Math.floor(durationSec / 60);
    const secs = (durationSec % 60).toString().padStart(2, '0');
    const isDNU = item.metadata?.dnu;
    const hasComments = !!item.metadata?.comments;
    const rating = item.metadata?.rating || 0;

    const getDisplayName = (filename: string) => filename.replace(/\.midi?$/i, '');
    
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
    
    const getPlaylistColor = (name: string) => {
      const colors = ['#4CAF50', '#2196F3', '#9C27B0', '#FF9800', '#E91E63', '#00BCD4', '#009688', '#FF5722', '#673AB7', '#3F51B5'];
      let hash = 0;
      for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
      return colors[Math.abs(hash) % colors.length];
    };

    const formatDate = (timestamp?: number) => {
      if (!timestamp) return '';
      const date = new Date(timestamp * 1000);
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    };

    return (
      <TouchableOpacity 
        style={[styles.fileItem, isSelected && { backgroundColor: themeColors.accentLight }, { borderBottomColor: themeColors.border }]} 
        onPress={onPlay}
        onLongPress={onSelect}
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
            <View style={{ flex: 1 }}>
              <Text style={[styles.fileName, { color: isDNU ? '#ff5252' : themeColors.text }]} numberOfLines={1}>
                {getDisplayName(item.name)}
              </Text>
              {item.metadata?.artist ? (
                <Text style={{ fontSize: 11, color: themeColors.accent, fontWeight: '600', marginTop: -2 }} numberOfLines={1}>
                  {item.metadata.artist}
                </Text>
              ) : null}
            </View>
            <View style={styles.tagsContainer}>
              {isDNU && (
                <View style={[styles.statusTag, { backgroundColor: '#ff5252' }]}>
                  <Text style={styles.statusTagText}>DNU</Text>
                </View>
              )}
              {item.processed && (
                <View style={[styles.statusTag, { backgroundColor: '#2196F3' }]}>
                  <Text style={styles.statusTagText}>CLEAN</Text>
                </View>
              )}
              {item.playlists?.map((pl: string) => (
                <View key={pl} style={[styles.statusTag, { backgroundColor: getPlaylistColor(pl) }]}>
                  <Text style={styles.statusTagText}>{pl.substring(0, 4).toUpperCase()}</Text>
                </View>
              ))}
            </View>
          </View>
          <View style={styles.metaRow}>
            <Text style={[styles.fileMeta, { color: themeColors.textMuted }]}>
              {item.length ? `${mins}:${secs} • ` : ''}
              {formatDate(item.created)}
            </Text>
            {item.group === 'processed' && (
              <>
                <TouchableOpacity onPress={onTempoPress}>
                  <View style={[styles.tempoTag, { borderColor: themeColors.accent, backgroundColor: themeColors.background }]}>
                    <Text style={[styles.tempoTagText, { color: themeColors.accent }]}>{tempo.toFixed(2)}x</Text>
                  </View>
                </TouchableOpacity>
                {melodyFactor !== undefined && (
                  <View style={[styles.statTag, { backgroundColor: themeColors.surfaceSecondary }]}>
                    <Text style={[styles.statTagText, { color: themeColors.textMuted }]}>M:{Math.round(melodyFactor*100)}%</Text>
                  </View>
                )}
                {rhythmFactor !== undefined && (
                  <View style={[styles.statTag, { backgroundColor: themeColors.surfaceSecondary }]}>
                    <Text style={[styles.statTagText, { color: themeColors.textMuted }]}>R:{Math.round(rhythmFactor*100)}%</Text>
                  </View>
                )}
                {item.metadata?.clean_profile && (
                  <View style={[styles.statTag, { backgroundColor: themeColors.surfaceSecondary }]}>
                    <Text style={[styles.statTagText, { color: themeColors.textMuted }]}>P:{item.metadata.clean_profile.charAt(0).toUpperCase()}</Text>
                  </View>
                )}
                {renderStars(rating)}
              </>
            )}
            {hasComments && (
               <Ionicons name="chatbox-ellipses-outline" size={14} color={themeColors.accent} style={{marginLeft: 8}} />
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
});

export const FilesScreen = () => {
  // Use specific selectors to prevent re-renders when other parts of the store (like playback position) update
  const files = useStore(state => state.files);
  const setFiles = useStore(state => state.setFiles);
  const playlists = useStore(state => state.playlists);
  const setPlaylists = useStore(state => state.setPlaylists);
  const theme = useStore(state => state.theme);
  const isPianoConnected = useStore(state => state.isPianoConnected);
  
  const themeColors = Colors[theme];
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'artist' | 'rating' | 'created' | 'length'>('name');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['processed']));
  
  const { play } = useAudioPlayer();
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  
  // Modals
  const [tempoModal, setTempoModal] = useState<{ visible: boolean, filename: string, value: string }>({
    visible: false, filename: '', value: '1.0'
  });
  const [renameModal, setRenameModal] = useState<{ visible: boolean, oldName: string, newName: string }>({
    visible: false, oldName: '', newName: ''
  });
  const [playlistModal, setPlaylistModal] = useState<{ visible: boolean, newPlaylistName: string }>({ 
    visible: false, newPlaylistName: '' 
  });
  const [detailsModal, setDetailsModal] = useState<{ 
    visible: boolean, 
    filenames: string[],
    dnu: boolean,
    comments: string,
    rating: number
  }>({ 
    visible: false, 
    filenames: [],
    dnu: false,
    comments: '',
    rating: 0
  });
  const cleanModal = useStore(state => state.cleanModal);
  const setCleanModal = useStore(state => state.setCleanModal);
  const setUniqueMetadata = useStore(state => state.setUniqueMetadata);

  const fetchFiles = async () => {
    try {
      const data = await fileApi.listFiles();
      setFiles(data);
      const pData = await playlistApi.listPlaylists();
      setPlaylists(pData);
      const metaData = await fileApi.getUniqueMetadata();
      setUniqueMetadata(metaData);
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      setLoading(true);
      fetchFiles().finally(() => setLoading(false));
    });
    return () => task.cancel();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchFiles();
    setRefreshing(false);
  };

  const toggleGroup = (group: string) => {
    const next = new Set(expandedGroups);
    if (next.has(group)) next.delete(group);
    else next.add(group);
    setExpandedGroups(next);
  };

  const toggleSelect = React.useCallback((filename: string) => {
    setSelectedFiles(prev => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  }, []);

  const clearSelection = () => setSelectedFiles(new Set());

  const flattenedData = useMemo(() => {
    const result: any[] = [];
    const s = search.toLowerCase().replace(/[-_]/g, ' ');
    ['processed', 'raw'].forEach(group => {
      const groupFiles = files[group as keyof typeof files] || [];
      const filtered = groupFiles.filter(f => {
        if (f.name.startsWith('hybrid:')) return false;
        if (!s) return true;
        const matchesName = f.name.toLowerCase().replace(/[-_]/g, ' ').includes(s);
        const matchesArtist = f.metadata?.artist?.toLowerCase().replace(/[-_]/g, ' ').includes(s);
        const matchesGenre = f.metadata?.genre?.toLowerCase().replace(/[-_]/g, ' ').includes(s);
        const matchesMood = f.metadata?.mood?.toLowerCase().replace(/[-_]/g, ' ').includes(s);
        const matchesSource = f.metadata?.source?.toLowerCase().replace(/[-_]/g, ' ').includes(s);
        const matchesComments = f.metadata?.comments?.toLowerCase().replace(/[-_]/g, ' ').includes(s);
        return matchesName || matchesArtist || matchesGenre || matchesMood || matchesSource || matchesComments;
      })
      .sort((a, b) => {
        if (sortBy === 'name') return a.name.localeCompare(b.name);
        if (sortBy === 'artist') {
          const artA = a.metadata?.artist || 'zzz'; // Sort empty artists to bottom
          const artB = b.metadata?.artist || 'zzz';
          return artA.localeCompare(artB);
        }
        if (sortBy === 'rating') {
          return (b.metadata?.rating || 0) - (a.metadata?.rating || 0);
        }
        if (sortBy === 'created') return (b.created || 0) - (a.created || 0);
        if (sortBy === 'length') return (b.length || 0) - (a.length || 0);
        return 0;
      });
      result.push({ type: 'header', group, count: filtered.length });
      if (expandedGroups.has(group)) {
        filtered.forEach(f => result.push({ type: 'file', group, ...f }));
      }
    });
    return result;
  }, [files, search, sortBy, expandedGroups]);

  const handleBulkDelete = () => {
    if (selectedFiles.size === 0) return;
    Alert.alert('Bulk Delete', `Delete ${selectedFiles.size} files?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        setLoading(true);
        try {
          for (const fn of Array.from(selectedFiles)) await fileApi.deleteFile(fn);
          clearSelection();
          await fetchFiles();
        } finally { setLoading(false); }
      }}
    ]);
  };
const openCleanSettings = () => {
  const selectedList = Array.from(selectedFiles);
  // Allow cleaning if we have only RAW files OR only PROCESSED files (no mixing for simplicity)
  const hasRaw = selectedList.some(fn => fn.includes('_original'));
  const hasProcessed = selectedList.some(fn => !fn.includes('_original'));

  if (hasRaw && hasProcessed) {
    Alert.alert('Selection Error', 'Please select either only Raw files or only Processed files to clean.');
    return;
  }

  // Default settings
  let initialRhythm = 1.0;
  let initialMelody = 1.0;
  let initialProfile = 'light';

  // If exactly one processed file is selected, pre-fill with its metadata
  if (selectedList.length === 1 && hasProcessed) {
    const filename = selectedList[0];
    const found = files.processed.find(f => f.name === filename);
    if (found?.metadata) {
      initialRhythm = found.metadata.rhythm_factor || 1.0;
      initialMelody = found.metadata.melody_factor || 1.0;
      initialProfile = found.metadata.clean_profile || 'light';
    }
  }

  setCleanModal({
    visible: true,
    filenames: selectedList,
    rhythm: initialRhythm,
    melody: initialMelody,
    profile: initialProfile
  });
};

  const handleBulkClean = async () => {
    const toClean = [...cleanModal.filenames];
    const { profile, rhythm, melody } = cleanModal;
    setCleanModal({ visible: false });
    setLoading(true);
    try {
      for (const fn of toClean) {
        await processApi.clean(fn, profile, rhythm, melody);
      }
      clearSelection();
      await fetchFiles();
      Alert.alert('Clean Complete', `Successfully cleaned ${toClean.length} files.`);
    } catch (error) {
      Alert.alert('Processing Error', 'Failed to clean one or more files.');
    } finally {
      setLoading(false);
    }
  };

  const handleAddToPlaylist = async (plName: string) => {
    const toAdd = Array.from(selectedFiles).filter(fn => !fn.includes('_original'));
    if (toAdd.length === 0) {
      Alert.alert('Restricted', 'Only processed files can be added to playlists.');
      return;
    }
    try {
      setLoading(true);
      await playlistApi.addBulk(plName, toAdd);
      setPlaylistModal({ ...playlistModal, visible: false });
      clearSelection();
      await fetchFiles();
    } finally { setLoading(false); }
  };

  const handleCreateAndAdd = async () => {
    const name = playlistModal.newPlaylistName.trim();
    if (!name) return;
    const toAdd = Array.from(selectedFiles).filter(fn => !fn.includes('_original'));
    if (toAdd.length === 0) {
      Alert.alert('Restricted', 'Only processed files can be added to playlists.');
      return;
    }
    try {
      setLoading(true);
      await playlistApi.createPlaylist(name);
      await playlistApi.addBulk(name, toAdd);
      setPlaylistModal({ visible: false, newPlaylistName: '' });
      clearSelection();
      await fetchFiles();
    } catch (e) {
      Alert.alert('Error', 'Failed to create playlist');
    } finally {
      setLoading(false);
    }
  };

  const handleBulkSendToPiano = async () => {
    if (!isPianoConnected) {
      Alert.alert('Not Connected', 'Connect to piano first.');
      return;
    }
    const toSend = Array.from(selectedFiles).filter(fn => !fn.includes('_original'));
    if (toSend.length === 0) {
      Alert.alert('Restricted Action', 'Direct play of raw files is prohibited to protect hardware.');
      return;
    }
    const first = toSend[0];
    if (first) {
      try {
        await pianoApi.sendToDisk(first);
        clearSelection();
      } catch (e: any) {
        Alert.alert('Error', e.response?.data?.detail || 'Failed');
      }
    }
  };

  const handleRename = async () => {
    if (!renameModal.newName.trim()) return;
    try {
      setLoading(true);
      await fileApi.renameFile(renameModal.oldName, renameModal.newName.trim());
      setRenameModal(prev => ({ ...prev, visible: false }));
      clearSelection();
      await fetchFiles();
    } catch (error) {
      Alert.alert('Error', 'Failed to rename file');
    } finally {
      setLoading(false);
    }
  };

  const openBulkDetails = () => {
    const selectedList = Array.from(selectedFiles);
    if (selectedList.length === 0) return;
    let initialDnu = false;
    let initialComments = '';
    let initialRating = 0;
    if (selectedList.length === 1) {
      const filename = selectedList[0];
      const found = [...files.processed, ...files.raw].find(f => f.name === filename);
      if (found?.metadata) {
        initialDnu = found.metadata.dnu || false;
        initialComments = found.metadata.comments || '';
        initialRating = found.metadata.rating || 0;
      }
    }
    setDetailsModal({ 
      visible: true, 
      filenames: selectedList, 
      dnu: initialDnu, 
      comments: initialComments,
      rating: initialRating
    });
  };

  const getPlaylistColor = (name: string) => {
    const colors = ['#4CAF50', '#2196F3', '#9C27B0', '#FF9800', '#E91E63', '#00BCD4', '#009688', '#FF5722', '#673AB7', '#3F51B5'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  };

  const renderItem = React.useCallback(({ item }: { item: any }) => {
    if (item.type === 'header') {
      const isExpanded = expandedGroups.has(item.group);
      return (
        <TouchableOpacity 
          style={[styles.groupHeader, { backgroundColor: themeColors.surface, borderBottomColor: themeColors.border, height: 50 }]} 
          onPress={() => toggleGroup(item.group)}
        >
          <Text style={[styles.groupTitle, { color: themeColors.text }]}>{item.group.toUpperCase()} ({item.count})</Text>
          <Ionicons name={isExpanded ? "chevron-down" : "chevron-forward"} size={18} color={themeColors.accent} />
        </TouchableOpacity>
      );
    }

    return (
      <FileListItem
        item={item}
        isSelected={selectedFiles.has(item.name)}
        themeColors={themeColors}
        playlists={playlists}
        onPlay={() => selectedFiles.size > 0 ? toggleSelect(item.name) : play(item.name)}
        onSelect={() => toggleSelect(item.name)}
        onTempoPress={() => setTempoModal({ visible: true, filename: item.name, value: (item.metadata?.tempo_factor || 1.0).toString() })}
      />
    );
  }, [expandedGroups, selectedFiles, themeColors, play, toggleSelect, playlists]);

  const getItemLayout = (data: any, index: number) => {
    const ITEM_HEIGHT = 75;
    const HEADER_HEIGHT = 50;
    
    // We assume mostly items for the layout calculation
    return {
      length: ITEM_HEIGHT,
      offset: ITEM_HEIGHT * index,
      index,
    };
  };

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      {/* Clean Settings Modal */}
      <Modal visible={cleanModal.visible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: themeColors.surface }]}>
            <Text style={[styles.modalTitle, { color: themeColors.text }]}>Clean MIDI Settings</Text>
            <Text style={[styles.modalSubtitle, { color: themeColors.textMuted, marginBottom: 20 }]}>
              Adjust velocity for {cleanModal.filenames.length} files
            </Text>

            <View style={styles.sliderContainer}>
              <Text style={[styles.label, { color: themeColors.text, marginBottom: 10 }]}>Melody Velocity</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: themeColors.surfaceSecondary, borderRadius: 8, padding: 5 }}>
                <TouchableOpacity 
                  onPress={() => setCleanModal({ melody: Math.max(0.2, cleanModal.melody - 0.05) })}
                  style={{ padding: 10 }}
                >
                  <Ionicons name="remove-circle-outline" size={32} color={themeColors.accent} />
                </TouchableOpacity>
                <Text style={{ color: themeColors.accent, fontWeight: '700', fontSize: 18, minWidth: 60, textAlign: 'center' }}>
                  {Math.round(cleanModal.melody * 100)}%
                </Text>
                <TouchableOpacity 
                  onPress={() => setCleanModal({ melody: Math.min(2.0, cleanModal.melody + 0.05) })}
                  style={{ padding: 10 }}
                >
                  <Ionicons name="add-circle-outline" size={32} color={themeColors.accent} />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.sliderContainer}>
              <Text style={[styles.label, { color: themeColors.text, marginBottom: 10 }]}>Rhythm Velocity</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: themeColors.surfaceSecondary, borderRadius: 8, padding: 5 }}>
                <TouchableOpacity 
                  onPress={() => setCleanModal({ rhythm: Math.max(0.2, cleanModal.rhythm - 0.05) })}
                  style={{ padding: 10 }}
                >
                  <Ionicons name="remove-circle-outline" size={32} color={themeColors.accent} />
                </TouchableOpacity>
                <Text style={{ color: themeColors.accent, fontWeight: '700', fontSize: 18, minWidth: 60, textAlign: 'center' }}>
                  {Math.round(cleanModal.rhythm * 100)}%
                </Text>
                <TouchableOpacity 
                  onPress={() => setCleanModal({ rhythm: Math.min(2.0, cleanModal.rhythm + 0.05) })}
                  style={{ padding: 10 }}
                >
                  <Ionicons name="add-circle-outline" size={32} color={themeColors.accent} />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.sliderContainer}>
              <Text style={[styles.label, { color: themeColors.text, marginBottom: 10 }]}>Pedal Intensity</Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {['light', 'medium', 'full'].map((p) => (
                  <TouchableOpacity 
                    key={p} 
                    onPress={() => setCleanModal({ profile: p })}
                    style={[
                      styles.modalBtn, 
                      styles.modalBtnFlex, 
                      { backgroundColor: cleanModal.profile === p ? themeColors.accent : themeColors.surfaceSecondary }
                    ]}
                  >
                    <Text style={{ color: cleanModal.profile === p ? '#fff' : themeColors.text, fontWeight: '600' }}>
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={[styles.modalButtons, { marginTop: 20 }]}>
              <TouchableOpacity style={[styles.modalBtn, styles.modalBtnFlex, { backgroundColor: themeColors.surfaceSecondary }]} onPress={() => setCleanModal({ visible: false })}>
                <Text style={{ color: themeColors.text }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, styles.modalBtnFlex, { backgroundColor: themeColors.accent }]} onPress={handleBulkClean}>
                <Text style={{color: '#fff', fontWeight: '700'}}>Start Cleaning</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <SongDetailsModal
        visible={detailsModal.visible}
        filenames={detailsModal.filenames}
        onClose={() => setDetailsModal(p => ({ ...p, visible: false }))}
        onSave={() => {
          clearSelection();
          fetchFiles();
        }}
        onCleanPress={(filename) => {
          setSelectedFiles(new Set([filename]));
          setTimeout(openCleanSettings, 100);
        }}
      />

      <Modal visible={tempoModal.visible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: themeColors.surface }]}>
            <Text style={[styles.modalTitle, { color: themeColors.text }]}>Adjust Tempo</Text>
            <TextInput style={[styles.modalInput, { borderColor: themeColors.border, backgroundColor: themeColors.background, color: themeColors.text }]} value={tempoModal.value} onChangeText={(v) => setTempoModal(p => ({ ...p, value: v }))} keyboardType="numeric" autoFocus />
            <View style={styles.modalButtons}>
              <TouchableOpacity style={[styles.modalBtn, styles.modalBtnFlex, { backgroundColor: themeColors.surfaceSecondary }]} onPress={() => setTempoModal(p => ({ ...p, visible: false }))}>
                <Text style={{ color: themeColors.text }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, styles.modalBtnFlex, { backgroundColor: themeColors.accent }]} onPress={async () => {
                await processApi.tempo(tempoModal.filename, parseFloat(tempoModal.value));
                setTempoModal(p => ({ ...p, visible: false }));
                fetchFiles();
              }}><Text style={{color: '#fff'}}>Update</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Rename Modal */}
      <Modal visible={renameModal.visible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: themeColors.surface }]}>
            <Text style={[styles.modalTitle, { color: themeColors.text }]}>Rename File</Text>
            <TextInput
              style={[styles.modalInput, { borderColor: themeColors.border, backgroundColor: themeColors.background, color: themeColors.text }]}
              value={renameModal.newName}
              onChangeText={(v) => setRenameModal(p => ({ ...p, newName: v }))}
              autoFocus
              autoCapitalize="none"
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity style={[styles.modalBtn, styles.modalBtnFlex, { backgroundColor: themeColors.surfaceSecondary }]} onPress={() => setRenameModal(prev => ({ ...prev, visible: false }))}>
                <Text style={{ color: themeColors.text }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, styles.modalBtnFlex, { backgroundColor: themeColors.accent }]} onPress={handleRename}>
                <Text style={{color: '#fff'}}>Rename</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Playlist Select Modal */}
      <Modal visible={playlistModal.visible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '85%', backgroundColor: themeColors.surface }]}>
            <Text style={[styles.modalTitle, { color: themeColors.text }]}>Add to Playlist</Text>
            <View style={styles.modalInputGroup}>
              <TextInput style={[styles.modalInput, { marginBottom: 10, borderColor: themeColors.border, backgroundColor: themeColors.background, color: themeColors.text }]} placeholder="New Playlist Name" placeholderTextColor={themeColors.textMuted} value={playlistModal.newPlaylistName} onChangeText={(v) => setPlaylistModal(p => ({ ...p, newPlaylistName: v }))} />
              <TouchableOpacity style={[styles.modalBtn, styles.modalBtnFull, { backgroundColor: themeColors.accent, marginBottom: 20 }]} onPress={handleCreateAndAdd} disabled={!playlistModal.newPlaylistName.trim()}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>Create & Add</Text>
              </TouchableOpacity>
            </View>
            <View style={[styles.divider, { backgroundColor: themeColors.border }]} />
            <Text style={[styles.modalSubtitle, { color: themeColors.textMuted, marginTop: 10 }]}>Or choose existing:</Text>
            <ScrollView style={{ marginTop: 5 }}>
              {Object.keys(playlists).map(name => (
                <TouchableOpacity key={name} style={[styles.playlistOption, { borderBottomColor: themeColors.border }]} onPress={() => handleAddToPlaylist(name)}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={[styles.statusTag, { backgroundColor: getPlaylistColor(name), marginRight: 10, width: 8, height: 16 }]} />
                    <Text style={[styles.playlistOptionText, { color: themeColors.text }]}>{name}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={[styles.modalBtn, styles.modalBtnFull, { backgroundColor: themeColors.surfaceSecondary, marginTop: 10 }]} onPress={() => setPlaylistModal(p => ({ ...p, visible: false }))}>
              <Text style={{ color: themeColors.text }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {selectedFiles.size > 0 && (
        <View style={[styles.actionBar, { backgroundColor: themeColors.accent }]}>
          <TouchableOpacity style={styles.actionCount} onPress={clearSelection}>
            <Ionicons name="close-circle" size={24} color="#fff" />
            <Text style={styles.actionCountText}>{selectedFiles.size}</Text>
          </TouchableOpacity>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actionButtons}>
            <TouchableOpacity style={styles.barBtn} onPress={handleBulkSendToPiano}>
              <Ionicons name="musical-notes-outline" size={20} color="#fff" />
              <Text style={styles.barBtnText}>Piano</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.barBtn} onPress={openCleanSettings}>
              <Ionicons name="sparkles-outline" size={20} color="#fff" />
              <Text style={styles.barBtnText}>Clean</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.barBtn} onPress={openBulkDetails}>
              <Ionicons name="information-circle-outline" size={20} color="#fff" />
              <Text style={styles.barBtnText}>Details</Text>
            </TouchableOpacity>
            
            {selectedFiles.size === 1 && (
              <TouchableOpacity style={styles.barBtn} onPress={() => {
                const fn = Array.from(selectedFiles)[0];
                setRenameModal({ visible: true, oldName: fn, newName: fn.replace(/\.midi?$/i, '') });
              }}>
                <Ionicons name="pencil-outline" size={20} color="#fff" />
                <Text style={styles.barBtnText}>Rename</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.barBtn} onPress={() => setPlaylistModal({ ...playlistModal, visible: true })}>
              <Ionicons name="list-outline" size={20} color="#fff" />
              <Text style={styles.barBtnText}>List</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.barBtn} onPress={handleBulkDelete}>
              <Ionicons name="trash-outline" size={20} color="#fff" />
              <Text style={[styles.barBtnText, { color: '#fff' }]}>Delete</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      )}

      <View style={[styles.header, { borderBottomColor: themeColors.border }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <TextInput 
            style={[styles.searchBar, { flex: 1, backgroundColor: themeColors.surface, color: themeColors.text, marginBottom: 0 }]} 
            placeholder="Search files..." 
            placeholderTextColor={themeColors.textMuted} 
            value={search} 
            onChangeText={setSearch} 
          />
          <TouchableOpacity 
            onPress={onRefresh} 
            disabled={refreshing}
            style={{ padding: 5 }}
          >
            {refreshing ? (
              <ActivityIndicator size="small" color={themeColors.accent} />
            ) : (
              <Ionicons name="refresh" size={24} color={themeColors.accent} />
            )}
          </TouchableOpacity>
        </View>
        <View style={styles.sortBar}>
          {['name', 'artist', 'rating', 'created', 'length'].map((s) => (
            <TouchableOpacity key={s} onPress={() => setSortBy(s as any)} style={[styles.sortBtn, sortBy === s ? { backgroundColor: themeColors.accent } : { backgroundColor: themeColors.surfaceSecondary }]}>
              <Text style={[styles.sortBtnText, sortBy === s ? { color: '#fff' } : { color: themeColors.text }]}>{s.charAt(0).toUpperCase() + s.slice(1)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <FlatList
        data={flattenedData}
        keyExtractor={(item) => item.type === 'header' ? `header-${item.group}` : `file-${item.name}`}
        extraData={selectedFiles}
        removeClippedSubviews={true}
        maxToRenderPerBatch={10}
        windowSize={5}
        initialNumToRender={15}
        contentContainerStyle={{ paddingBottom: 100 }}
        renderItem={renderItem}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { padding: 15, borderBottomWidth: 1 },
  searchBar: { padding: 10, borderRadius: 8, fontSize: 16, marginBottom: 10 },
  sortBar: { flexDirection: 'row', alignItems: 'center' },
  sortBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 15, marginRight: 5 },
  sortBtnText: { fontSize: 12 },
  fileItem: { flexDirection: 'row', padding: 8, paddingHorizontal: 15, alignItems: 'center', borderBottomWidth: 1 },
  selectionIndicator: { marginRight: 15 },
  fileInfo: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fileName: { fontSize: 14, fontWeight: '500', flex: 1, marginRight: 5 },
  tagsContainer: { flexDirection: 'row', gap: 4 },
  statusTag: { paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3 },
  statusTagText: { color: '#fff', fontSize: 8, fontWeight: '800' },
  fileMeta: { fontSize: 11 },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  tempoTag: { marginLeft: 10, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 },
  tempoTagText: { fontSize: 10, fontWeight: '700' },
  statTag: { marginLeft: 5, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 },
  statTagText: { fontSize: 9, fontWeight: '600' },
  actionBar: { flexDirection: 'row', padding: 10, alignItems: 'center', position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100, elevation: 10, height: 75, paddingTop: Platform.OS === 'ios' ? 30 : 10 },
  actionCount: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, borderRightWidth: 1, borderRightColor: 'rgba(255,255,255,0.2)' },
  actionCountText: { color: '#fff', fontWeight: '700', marginLeft: 5 },
  actionButtons: { paddingHorizontal: 10, gap: 20, alignItems: 'center' },
  barBtn: { alignItems: 'center', minWidth: 50 },
  barBtnText: { fontSize: 10, color: '#fff', fontWeight: '600', marginTop: 2 },
  groupHeader: { flexDirection: 'row', justifyContent: 'space-between', padding: 15, borderBottomWidth: 1 },
  groupTitle: { fontWeight: '700', letterSpacing: 1 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { width: '100%', borderRadius: 12, padding: 25 },
  modalTitle: { fontSize: 20, fontWeight: '700', marginBottom: 10 },
  modalSubtitle: { fontSize: 13, fontWeight: '600', marginBottom: 5 },
  modalInput: { borderWidth: 1, borderRadius: 8, padding: 15, fontSize: 18, textAlign: 'center' },
  modalButtons: { flexDirection: 'row', gap: 10, width: '100%' },
  modalBtn: { padding: 15, borderRadius: 8, alignItems: 'center', justifyContent: 'center', minHeight: 50 },
  modalBtnFull: { width: '100%' },
  modalBtnFlex: { flex: 1 },
  textArea: { borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 14, minHeight: 80 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  playlistOption: { padding: 15, borderBottomWidth: 1 },
  playlistOptionText: { fontSize: 20, fontWeight: '600' },
  divider: { height: 1, width: '100%', marginVertical: 10 },
  sliderContainer: { width: '100%', marginBottom: 20 },
  sliderHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  label: { fontSize: 14, fontWeight: '600' }
});
