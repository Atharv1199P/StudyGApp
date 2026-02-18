import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { showAlert } from '../services/alerts';
import { supabase } from '../services/supabase';

const Dashboard = () => {
  const router = useRouter();
  const { userData, loading: authLoading, logout } = useAuth();

  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [joinGroupId, setJoinGroupId] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [groupToDelete, setGroupToDelete] = useState(null);
  const [error, setError] = useState('');

  const todayLabel = useMemo(() => new Date().toLocaleDateString(), []);

  useEffect(() => {
    // Only redirect if we ARE NOT loading AND we HAVE NO user data
    if (!authLoading) {
      if (userData) {
        fetchGroups();
      } else {
        // Double check currentUser to prevent "flicker" logout
        router.replace('/welcome');
      }
    }
  }, [userData, authLoading]);

  /* ---------------- Fetch Groups ---------------- */
  const fetchGroups = async () => {
    setLoading(true);
    try {
      const { data: memberships, error } = await supabase
        .from('group_members')
        .select('group_id')
        .eq('user_id', userData.id);

      if (error) throw error;

      if (!memberships?.length) {
        setGroups([]);
        return;
      }

      const groupIds = memberships.map((m) => m.group_id);

      const { data, error: groupsError } = await supabase
        .from('groups')
        .select('*, group_members(user_id)')
        .in('id', groupIds)
        .order('created_at', { ascending: false });

      if (groupsError) throw groupsError;

      setGroups(
        data.map((g) => ({
          ...g,
          membersCount: g.group_members?.length || 0,
        })),
      );
    } catch (e) {
      setError(e.message || 'Failed to load groups');
    } finally {
      setLoading(false);
    }
  };

  /* ---------------- Auth ---------------- */
  const handleLogout = async () => {
    const performLogout = async () => {
      try {
        await logout();
        router.replace('/welcome');
      } catch (e) {
        router.replace('/welcome');
      }
    };

    showAlert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Logout', style: 'destructive', onPress: performLogout },
    ]);
  };

  /* ---------------- Create Group ---------------- */
  const createGroup = async () => {
    if (!groupName.trim()) {
      setError('Group name is required');
      return;
    }

    try {
      const { data: group, error } = await supabase
        .from('groups')
        .insert({
          name: groupName.trim(),
          description: groupDescription.trim(),
          created_by: userData.id,
          created_by_name: userData.name,
        })
        .select()
        .single();

      if (error) throw error;

      await supabase.from('group_members').insert({
        group_id: group.id,
        user_id: userData.id,
      });

      setShowCreateModal(false);
      setGroupName('');
      setGroupDescription('');
      fetchGroups();
      router.push(`/group/${group.id}`);
    } catch (e) {
      setError(e.message || 'Failed to create group');
    }
  };

  /* ---------------- Join Group ---------------- */
  const joinGroup = async () => {
    if (!joinGroupId.trim()) {
      setError('Group ID is required');
      return;
    }

    try {
      const { data: group } = await supabase
        .from('groups')
        .select('*')
        .eq('id', joinGroupId.trim())
        .single();

      if (!group) {
        setError('Group not found');
        return;
      }

      const { data: existing } = await supabase
        .from('group_members')
        .select('*')
        .eq('group_id', joinGroupId.trim())
        .eq('user_id', userData.id)
        .maybeSingle();

      if (!existing) {
        await supabase.from('group_members').insert({
          group_id: joinGroupId.trim(),
          user_id: userData.id,
        });
      }

      setShowJoinModal(false);
      setJoinGroupId('');
      fetchGroups();
      router.push(`/group/${joinGroupId.trim()}`);
    } catch (e) {
      setError(e.message || 'Failed to join group');
    }
  };

  /* ---------------- Password Verification ---------------- */
  const verifyPassword = async (password) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: userData.email,
        password,
      });
      
      if (error) {
        return false;
      }
      
      return true;
    } catch (e) {
      return false;
    }
  };

  /* ---------------- Delete Group ---------------- */
  const handleDeleteGroup = (group) => {
    if (group.created_by !== userData.id) {
      showAlert('Not allowed', 'Only the creator can delete this group.');
      return;
    }

    // If user is a teacher, require password confirmation
    if (userData.role === 'teacher') {
      setGroupToDelete(group);
      setShowPasswordModal(true);
      return;
    }

    // For non-teachers, proceed with normal deletion flow
    confirmDeleteGroup(group);
  };

  const confirmDeleteGroup = async (group) => {
    try {
      setLoading(true);

      // 1. Fetch file paths and session recordings to clean up storage
      const { data: groupFiles } = await supabase.from('files').select('path').eq('group_id', group.id);
      const { data: groupSessions } = await supabase.from('sessions').select('recording_path').eq('group_id', group.id);

      // 2. Delete messages
      await supabase.from('messages').delete().eq('group_id', group.id);

      // 3. Delete files from Storage & DB
      if (groupFiles && groupFiles.length > 0) {
        const paths = groupFiles.filter(f => f.path).map(f => f.path);
        if (paths.length > 0) {
          await supabase.storage.from('group-files').remove(paths);
        }
      }
      await supabase.from('files').delete().eq('group_id', group.id);

      // 4. Delete sessions from Storage & DB
      if (groupSessions && groupSessions.length > 0) {
        const recPaths = groupSessions.filter(s => s.recording_path).map(s => s.recording_path);
        if (recPaths.length > 0) {
          await supabase.storage.from('session-recordings').remove(recPaths);
        }
      }
      await supabase.from('sessions').delete().eq('group_id', group.id);

      // 5. Delete members and the group
      await supabase.from('group_members').delete().eq('group_id', group.id);
      const { error: groupErr } = await supabase.from('groups').delete().eq('id', group.id);
      if (groupErr) throw groupErr;

      await fetchGroups();
      showAlert('Success', 'Group and all its content deleted from Supabase.');
    } catch (e) {
      console.error('Delete failed:', e);
      showAlert('Delete Failed', e.message || 'Could not delete group.');
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordConfirm = async () => {
    if (!deletePassword.trim()) {
      setError('Password is required');
      return;
    }

    const isValidPassword = await verifyPassword(deletePassword);
    
    if (!isValidPassword) {
      setError('Incorrect password');
      return;
    }

    // Password is correct, proceed with deletion
    setShowPasswordModal(false);
    setDeletePassword('');
    setError('');
    
    if (groupToDelete) {
      showAlert(
        'Delete Group',
        `Are you sure you want to permanently delete "${groupToDelete.name}" and all its content?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: () => confirmDeleteGroup(groupToDelete) },
        ],
      );
    }
  };

  const handlePasswordCancel = () => {
    setShowPasswordModal(false);
    setDeletePassword('');
    setGroupToDelete(null);
    setError('');
  };

  /* ---------------- Guards ---------------- */
  if (authLoading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  if (!userData && !authLoading) {
    return null;
  }

  /* ---------------- UI ---------------- */
  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Dashboard</Text>
          <Text style={styles.subtitle}>Welcome back, {userData.name}</Text>
        </View>
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>

      {/* Stats */}
      <View style={styles.statsRow}>
        <Stat label="Your Groups" value={groups.length} />
        <Stat label="Role" value={userData.role} small />
        <Stat label="Today" value={todayLabel} small />
      </View>

      {/* Actions */}
      <View style={styles.actionsRow}>
        {userData.role === 'teacher' && (
          <ActionBtn text="Create Group" color="#0ea5e9" onPress={() => setShowCreateModal(true)} />
        )}
        <ActionBtn text="Join Group" color="#10b981" onPress={() => setShowJoinModal(true)} />
      </View>

      {error && <ErrorBox text={error} />}

      {/* Groups */}
      {loading ? (
        <View style={styles.center}><ActivityIndicator /></View>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16 }}
          ListEmptyComponent={<Text style={styles.empty}>No groups yet.</Text>}
          renderItem={({ item }) => (
            <GroupCard
              group={item}
              isOwner={item.created_by === userData.id}
              onOpen={() => router.push(`/group/${item.id}`)}
              onDelete={() => handleDeleteGroup(item)}
            />
          )}
        />
      )}

      {/* Create Modal */}
      <CreateJoinModal
        visible={showCreateModal}
        title="Create Group"
        onCancel={() => setShowCreateModal(false)}
        onConfirm={createGroup}
      >
        <TextInput style={styles.input} placeholder="Group name" value={groupName} onChangeText={setGroupName} />
        <TextInput
          style={[styles.input, { height: 80 }]}
          placeholder="Description"
          multiline
          value={groupDescription}
          onChangeText={setGroupDescription}
        />
      </CreateJoinModal>

      {/* Join Modal */}
      <CreateJoinModal
        visible={showJoinModal}
        title="Join Group"
        onCancel={() => setShowJoinModal(false)}
        onConfirm={joinGroup}
      >
        <TextInput style={styles.input} placeholder="Group ID" value={joinGroupId} onChangeText={setJoinGroupId} />
      </CreateJoinModal>

      {/* Password Confirmation Modal */}
      <Modal visible={showPasswordModal} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Confirm Password</Text>
            <Text style={styles.modalSubtitle}>
              As a teacher, you must enter your password to delete this group.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your password"
              value={deletePassword}
              onChangeText={setDeletePassword}
              secureTextEntry
            />
            {error && (
              <Text style={styles.errorText}>{error}</Text>
            )}
            <View style={styles.modalRow}>
              <TouchableOpacity style={styles.modalPrimary} onPress={handlePasswordConfirm}>
                <Text style={styles.btnText}>Confirm</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalGhost} onPress={handlePasswordCancel}>
                <Text>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

/* ---------------- Small Components ---------------- */

const Stat = ({ label, value, small }) => (
  <View style={styles.statCard}>
    <Text style={styles.statLabel}>{label}</Text>
    <Text style={small ? styles.statSmall : styles.statBig}>{value}</Text>
  </View>
);

const ActionBtn = ({ text, color, onPress }) => (
  <TouchableOpacity style={[styles.actionBtn, { backgroundColor: color }]} onPress={onPress}>
    <Text style={styles.actionText}>{text}</Text>
  </TouchableOpacity>
);

const ErrorBox = ({ text }) => (
  <View style={styles.errorBox}>
    <Text style={styles.errorText}>{text}</Text>
  </View>
);

const GroupCard = ({ group, isOwner, onOpen, onDelete }) => (
  <View style={styles.card}>
    <Text style={styles.cardTitle}>{group.name}</Text>
    <Text style={styles.cardSubTitle}>{group.description}</Text>
    <View style={styles.cardMetaRow}>
      <Ionicons name="people" size={14} color="#94a3b8" />
    <Text style={styles.cardMeta}>{group.membersCount} members</Text>
    </View>

    <TouchableOpacity style={styles.openBtn} onPress={onOpen}>
    <Ionicons name="open-outline" size={20} color="white" />
      <Text style={styles.btnText}>Open Group</Text>
    </TouchableOpacity>

    {isOwner && (
      <TouchableOpacity style={styles.deleteBtn} onPress={onDelete}>
         <Ionicons name="trash-outline" size={18} color="#fca5a5" />
        <Text style={styles.btnText}>Delete Group</Text>
      </TouchableOpacity>
    )}
  </View>
);

const CreateJoinModal = ({ visible, title, children, onConfirm, onCancel }) => (
  <Modal visible={visible} transparent animationType="fade">
    <View style={styles.modalBg}>
      <View style={styles.modalCard}>
        <Text style={styles.modalTitle}>{title}</Text>
        {children}
        <View style={styles.modalRow}>
          <TouchableOpacity style={styles.modalPrimary} onPress={onConfirm}>
            <Text style={styles.btnText}>Confirm</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.modalGhost} onPress={onCancel}>
            <Text>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  </Modal>
);

/* ---------------- Styles ---------------- */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b1220' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    marginVertical: 20,
    padding: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderColor: '#1e293b',
  },
  title: { color: '#fff', fontSize: 22, fontWeight: '800',marginVertical: 10,  },
  subtitle: { color: '#94a3b8', fontSize: 12 },

  logoutBtn: { backgroundColor: '#ef4444', padding: 12, height: 40, borderRadius: 999, alignItems:'center', justifyContent:'center', display:'flex', flexDirection:'row', gap:1, marginHorizontal: 16, marginVertical: 10 },
  logoutText: { color: '#fff', fontWeight: '700' },

  statsRow: { flexDirection: 'row', gap: 10, padding: 16 },
  statCard: {
    flex: 1,
    backgroundColor: '#111827',
    borderRadius: 14,
    padding: 12,
  },
  statLabel: { color: '#94a3b8', fontSize: 12 },
  statBig: { color: '#fff', fontSize: 24, fontWeight: '800' },
  statSmall: { color: '#fff', fontSize: 14, fontWeight: '700' },

  actionsRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16 },

  actionBtn: { padding: 12, borderRadius: 999 },
  actionText: { color: '#fff', fontWeight: '800' },

  errorBox: {
    margin: 16,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(239,68,68,0.15)',
  },
  errorText: { color: '#fecaca' },

  card: {
    backgroundColor: '#111827',
    padding: 14,
    borderRadius: 14,
    marginBottom: 12,
  },
  cardTitle: { color: '#fff', fontWeight: '800', fontSize: 16 ,paddingVertical: 6 },
  cardSubTitle: { color: '#94a3b8', fontSize: 12 },
  cardMeta: { color: '#94a3b8', fontSize: 12 },
  cardMetaRow: { flexDirection: 'row', gap: 5, alignItems:'center', marginVertical: 6 },

  openBtn: { backgroundColor: '#0ea5e9', marginTop: 10, padding: 12, borderRadius: 12, alignItems:'center', justifyContent:'center', display:'flex', flexDirection:'row', gap:10 },
  deleteBtn: { backgroundColor: 'rgba(127, 29, 29, 0.3)', marginTop: 6, padding: 12, borderRadius: 12, borderColor:'rgba(239, 68, 68, 0.3)', borderWidth:1, alignItems:'center', justifyContent:'center', display:'flex', flexDirection:'row', gap:10},
  btnText: { color: '#fff', textAlign: 'center', fontWeight: '800'},

  empty: { color: '#94a3b8', textAlign: 'center', marginTop: 60 },

  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#fff', borderRadius: 14, padding: 16 },
  modalTitle: { fontSize: 18, fontWeight: '800', marginBottom: 10 },
  modalSubtitle: { fontSize: 14, color: '#6b7280', marginBottom: 16 },
  modalRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  modalPrimary: { flex: 1, backgroundColor: '#0ea5e9', padding: 12, borderRadius: 10 },
  modalGhost: { flex: 1, backgroundColor: '#e5e7eb', padding: 12, borderRadius: 10 },
  input: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, padding: 12, marginBottom: 8 },
});

export default Dashboard;
