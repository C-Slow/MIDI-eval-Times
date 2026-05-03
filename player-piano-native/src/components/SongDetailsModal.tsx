import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, TextInput, Switch, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/Colors';
import { useStore } from '../store/useStore';
import { settingsApi } from '../services/api';

// ... (SongDetailsModalProps unchanged)

export const SongDetailsModal = ({ visible, filenames, onClose, onSave, onCleanPress }: SongDetailsModalProps) => {
  const theme = useStore(state => state.theme);
  const files = useStore(state => state.files);
  const insets = useSafeAreaInsets();
  const themeColors = Colors[theme];
  
  const [loading, setLoading] = useState(false);
  const [dnu, setDnu] = useState(false);
  const [comments, setComments] = useState('');
  const [rating, setRating] = useState(0);
  const [artist, setArtist] = useState('');
  const [genre, setGenre] = useState('');
  const [mood, setMood] = useState('');
  const [source, setSource] = useState('');

  // Use a string representation of filenames to prevent re-runs due to array reference changes
  const filenamesKey = filenames.join('|');

  useEffect(() => {
    if (visible) {
      if (filenames.length === 1) {
        const filename = filenames[0];
        const found = [...files.processed, ...files.raw].find(f => f.name === filename);
        if (found?.metadata) {
          setDnu(found.metadata.dnu || false);
          setComments(found.metadata.comments || '');
          setRating(found.metadata.rating || 0);
          setArtist(found.metadata.artist || '');
          setGenre(found.metadata.genre || '');
          setMood(found.metadata.mood || '');
          setSource(found.metadata.source || '');
        } else {
          setDnu(false);
          setComments('');
          setRating(0);
          setArtist('');
          setGenre('');
          setMood('');
          setSource('');
        }
      } else {
        // Bulk edit defaults
        setDnu(false);
        setComments('');
        setRating(0);
        setArtist('');
        setGenre('');
        setMood('');
        setSource('');
      }
    }
  }, [visible, filenamesKey]);

  const handleSave = async () => {
    try {
      setLoading(true);
      await settingsApi.saveMetadataBulk(filenames, {
        dnu,
        comments,
        rating,
        artist,
        genre,
        mood,
        source
      });
      setLoading(false);
      onSave?.();
      onClose();
    } catch (error) {
      setLoading(false);
      Alert.alert('Error', 'Failed to save metadata');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.modalOverlay, { justifyContent: 'flex-end' }]}>
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 60}
          style={{ width: '100%' }}
        >
          <View style={[styles.modalContent, { 
            backgroundColor: themeColors.surface, 
            borderBottomLeftRadius: 0, 
            borderBottomRightRadius: 0,
            maxHeight: '90%',
            paddingBottom: insets.bottom + 20
          }]}>
            <View style={styles.header}>
              <Text style={[styles.modalTitle, { color: themeColors.text }]}>
                {filenames.length > 1 ? `Edit ${filenames.length} Files` : 'Song Details'}
              </Text>
              <TouchableOpacity onPress={onClose}>
                <Ionicons name="close" size={24} color={themeColors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView 
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              contentContainerStyle={{ paddingBottom: 120 }}
            >
              <View style={[styles.detailRow, { marginBottom: 20 }]}>
                <View>
                  <Text style={{ color: themeColors.text, fontWeight: '600' }}>Rating</Text>
                  <Text style={{ color: themeColors.textMuted, fontSize: 11 }}>Rate this performance</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 5 }}>
                  {[1, 2, 3, 4, 5].map(star => (
                    <TouchableOpacity key={star} onPress={() => setRating(rating === star ? 0 : star)}>
                      <Ionicons 
                        name={star <= rating ? "star" : "star-outline"} 
                        size={24} 
                        color={star <= rating ? "#FFD700" : themeColors.textMuted} 
                      />
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={[styles.detailRow, { marginBottom: 20 }]}>
                <View>
                  <Text style={{ color: themeColors.text, fontWeight: '600' }}>Do Not Use (DNU)</Text>
                  <Text style={{ color: themeColors.textMuted, fontSize: 11 }}>Mark as unsafe or poor quality</Text>
                </View>
                <Switch 
                  value={dnu} 
                  onValueChange={setDnu} 
                  trackColor={{ false: themeColors.border, true: '#ff5252' }} 
                />
              </View>

              <TextInput
                style={[styles.textArea, { 
                  borderColor: themeColors.border, 
                  backgroundColor: themeColors.background, 
                  color: themeColors.text, 
                  textAlignVertical: 'top',
                  marginBottom: 15
                }]}
                value={comments}
                onChangeText={setComments}
                placeholder="Add notes..."
                placeholderTextColor={themeColors.textMuted}
                multiline
                numberOfLines={4}
              />

              {filenames.length === 1 && (
                <View style={{ gap: 10 }}>
                  <View style={styles.metaField}>
                    <Text style={[styles.metaLabel, { color: themeColors.textMuted }]}>Artist</Text>
                    <TextInput 
                      style={[styles.metaInput, { color: themeColors.text, borderBottomColor: themeColors.border }]} 
                      value={artist} 
                      onChangeText={setArtist}
                      placeholder="Unknown Artist"
                      placeholderTextColor={themeColors.textMuted}
                    />
                  </View>
                  <View style={{ flexDirection: 'row', gap: 15 }}>
                    <View style={[styles.metaField, { flex: 1 }]}>
                      <Text style={[styles.metaLabel, { color: themeColors.textMuted }]}>Genre</Text>
                      <TextInput 
                        style={[styles.metaInput, { color: themeColors.text, borderBottomColor: themeColors.border }]} 
                        value={genre} 
                        onChangeText={setGenre}
                        placeholder="None"
                        placeholderTextColor={themeColors.textMuted}
                      />
                    </View>
                    <View style={[styles.metaField, { flex: 1 }]}>
                      <Text style={[styles.metaLabel, { color: themeColors.textMuted }]}>Mood</Text>
                      <TextInput 
                        style={[styles.metaInput, { color: themeColors.text, borderBottomColor: themeColors.border }]} 
                        value={mood} 
                        onChangeText={setMood}
                        placeholder="None"
                        placeholderTextColor={themeColors.textMuted}
                      />
                    </View>
                  </View>
                  <View style={styles.metaField}>
                    <Text style={[styles.metaLabel, { color: themeColors.textMuted }]}>Source (Game/Movie)</Text>
                    <TextInput 
                      style={[styles.metaInput, { color: themeColors.text, borderBottomColor: themeColors.border }]} 
                      value={source} 
                      onChangeText={setSource}
                      placeholder="None"
                      placeholderTextColor={themeColors.textMuted}
                    />
                  </View>
                </View>
              )}

              {filenames.length === 1 && onCleanPress && (
                <TouchableOpacity 
                  style={[styles.cleanLink, { borderTopColor: themeColors.border }]} 
                  onPress={() => {
                    onClose();
                    onCleanPress(filenames[0]);
                  }}
                >
                  <Ionicons name="sparkles-outline" size={18} color={themeColors.accent} />
                  <Text style={[styles.cleanLinkText, { color: themeColors.accent }]}>Adjust Clean Settings</Text>
                  <Ionicons name="chevron-forward" size={16} color={themeColors.accent} />
                </TouchableOpacity>
              )}
            </ScrollView>

            <View style={[styles.modalButtons, { marginTop: 20 }]}>
              <TouchableOpacity 
                style={[styles.modalBtn, styles.modalBtnFlex, { backgroundColor: themeColors.surfaceSecondary }]} 
                onPress={onClose}
              >
                <Text style={{ color: themeColors.text }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.modalBtn, styles.modalBtnFlex, { backgroundColor: themeColors.accent }]} 
                onPress={handleSave}
                disabled={loading}
              >
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={{color: '#fff', fontWeight: '700'}}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: { 
    flex: 1, 
    backgroundColor: 'rgba(0,0,0,0.5)', 
    justifyContent: 'center', 
    alignItems: 'center', 
    padding: 20 
  },
  modalContent: { 
    width: '100%', 
    borderRadius: 12, 
    padding: 25 
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20
  },
  modalTitle: { 
    fontSize: 20, 
    fontWeight: '700'
  },
  detailRow: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center' 
  },
  textArea: { 
    borderWidth: 1, 
    borderRadius: 8, 
    padding: 12, 
    fontSize: 14, 
    minHeight: 80 
  },
  modalButtons: { 
    flexDirection: 'row', 
    gap: 10, 
    width: '100%' 
  },
  modalBtn: { 
    padding: 15, 
    borderRadius: 8, 
    alignItems: 'center', 
    justifyContent: 'center', 
    minHeight: 50 
  },
  modalBtnFlex: { 
    flex: 1 
  },
  cleanLink: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    paddingTop: 15,
    borderTopWidth: 1,
  },
  cleanLinkText: {
    flex: 1,
    marginLeft: 10,
    fontWeight: '600',
    fontSize: 14,
  },
  metaField: {
    marginBottom: 5,
  },
  metaLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  metaInput: {
    fontSize: 15,
    borderBottomWidth: 1,
    paddingVertical: 4,
  }
});
