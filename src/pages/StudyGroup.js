import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Audio } from "expo-av";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import { cacheDirectory, FileSystemUploadType } from "expo-file-system";
import * as FileSystemLegacy from "expo-file-system/legacy";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import { useEffect, useMemo, useRef, useState } from "react";
import {
    ActivityIndicator,
    FlatList,
    Image,
    Linking,
    Modal,
    Platform,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { HeadlessFileParser } from "../components/HeadlessFileParser";
import { useAuth } from "../context/AuthContext";
import { showAlert } from "../services/alerts";
import { extractTextFromFile } from "../services/fileParser";
import {
    chatWithTutor,
    generateFlashcards,
    generateQuiz,
    generateSummary,
} from "../services/openai";
import { supabase } from "../services/supabase";
import { transcribeRecording } from "../services/transcription";

// Tabs constants...
const TAB_CHAT = "chat";
const TAB_FILES = "files";
const TAB_SESSIONS = "sessions";
const TAB_AI = "ai";

const StudyGroup = () => {
  const router = useRouter();
  const parserRef = useRef(null);
  const { groupId } = useLocalSearchParams();
  const { userData } = useAuth();

  const [group, setGroup] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [messageSending, setMessageSending] = useState(false);
  const [chatFile, setChatFile] = useState(null);
  const [chatFilePreview, setChatFilePreview] = useState(null);

  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);

  const [sessions, setSessions] = useState([]);
  const [sessionTitle, setSessionTitle] = useState("");
  const [sessionDescription, setSessionDescription] = useState("");
  const [sessionStartTime, setSessionStartTime] = useState(new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [pickerMode, setPickerMode] = useState("date");
  const [tempDate, setTempDate] = useState(new Date());
  const [sessionLoading, setSessionLoading] = useState(false);

  const [recording, setRecording] = useState(null);
  const [recordingSessionId, setRecordingSessionId] = useState(null);
  const [isProcessingRecording, setIsProcessingRecording] = useState(false);
  const [recordingUrls, setRecordingUrls] = useState({});
  const [summaryLoading, setSummaryLoading] = useState({});
  const [deleteLoading, setDeleteLoading] = useState({});
  const [deletedFileIds, setDeletedFileIds] = useState(new Set());

  const [activeTab, setActiveTab] = useState(TAB_CHAT);

  const [aiContent, setAiContent] = useState("");
  const [aiResult, setAiResult] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);

  // Quiz interaction state
  const [quizSelections, setQuizSelections] = useState({}); // { questionIndex: selectedOptionIndex }
  const [quizRevealed, setQuizRevealed] = useState({}); // { questionIndex: true/false }
  const [quizSubmitted, setQuizSubmitted] = useState(false); // Track if quiz has been submitted

  const [tutorMessages, setTutorMessages] = useState([]);
  const [tutorInput, setTutorInput] = useState("");
  const [tutorLoading, setTutorLoading] = useState(false);

  // Password confirmation state for session deletion
  const [showSessionPasswordModal, setShowSessionPasswordModal] =
    useState(false);
  const [sessionDeletePassword, setSessionDeletePassword] = useState("");
  const [sessionToDelete, setSessionToDelete] = useState(null);
  const [sessionDeleteError, setSessionDeleteError] = useState("");

  // Join Live Modal State
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [joinName, setJoinName] = useState("");
  const [joinRoleNo, setJoinRoleNo] = useState("");
  const [joiningSession, setJoiningSession] = useState(null);

  // Attendance View State
  const [showAttendanceModal, setShowAttendanceModal] = useState(false);
  const [attendanceList, setAttendanceList] = useState([]);
  const [loadingAttendance, setLoadingAttendance] = useState(false);
  const [viewingAttendanceSession, setViewingAttendanceSession] =
    useState(null);

  const channelsRef = useRef([]);

  const gid =
    typeof groupId === "string"
      ? groupId
      : Array.isArray(groupId)
        ? groupId[0]
        : "";

  const copyGroupId = async () => {
    try {
      if (!gid) return;
      await Clipboard.setStringAsync(String(gid));
      showAlert("Copied!", "Group ID copied to clipboard");
    } catch (e) {
      showAlert("Copy failed", e?.message || "Could not copy Group ID");
    }
  };

  const loadRecordingUrl = async (session) => {
    try {
      if (!session?.recording_path) return;
      const { data, error } = await supabase.storage
        .from("session-recordings")
        .createSignedUrl(session.recording_path, 3600);
      if (error) throw error;
      const signedUrl = data?.signedUrl || "";
      if (!signedUrl) return;
      setRecordingUrls((prev) => ({ ...prev, [session.id]: signedUrl }));
    } catch (e) {
      // Background operation; don't alert.
      // eslint-disable-next-line no-console
      console.error("loadRecordingUrl failed", e);
    }
  };

  useEffect(() => {
    return () => {
      channelsRef.current.forEach((ch) => {
        try {
          supabase.removeChannel(ch);
        } catch {
          // ignore
        }
      });
      channelsRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!userData || !gid) return;

    (async () => {
      await fetchGroup();
      await fetchFiles();
      await fetchSessions();
      await subscribeMessages();
      await subscribeSessions();
      await subscribeFiles();
    })();
  }, [userData, gid]);

  // Cleanup DateTimePicker on unmount
  useEffect(() => {
    return () => {
      setShowPicker(false);
      setPickerMode("date");
    };
  }, []);

  const fetchGroup = async () => {
    try {
      const { data: groupData, error } = await supabase
        .from("groups")
        .select("*")
        .eq("id", gid)
        .single();

      if (error || !groupData) {
        setTimeout(() => router.replace("/dashboard"), 0);
        return;
      }

      const isGroupCreator = groupData.created_by === userData.id;

      if (!isGroupCreator) {
        const { data: membership, error: membershipError } = await supabase
          .from("group_members")
          .select("*")
          .eq("group_id", gid)
          .eq("user_id", userData.id)
          .maybeSingle();

        if (membershipError || !membership) {
          setTimeout(() => router.replace("/dashboard"), 0);
          return;
        }
      }

      const { data: members } = await supabase
        .from("group_members")
        .select("user_id")
        .eq("group_id", gid);

      setGroup({
        ...groupData,
        membersCount: members ? members.length : 0,
      });
    } catch {
      setTimeout(() => router.replace("/dashboard"), 0);
    }
  };

  const subscribeMessages = async () => {
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("group_id", gid)
      .order("created_at", { ascending: true });

    if (!error && data) {
      setMessages(data);
    }

    const channel = supabase
      .channel(`messages:group:${gid}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `group_id=eq.${gid}`,
        },
        (payload) => {
          console.log("[Real-time] New message received:", payload.new);
          setMessages((prev) => {
            if (prev.some((m) => m.id === payload.new.id)) return prev;
            return [...prev, payload.new];
          });
        },
      )
      .subscribe((status) => {
        console.log("[Real-time] Messages channel status:", status);
        if (status === "SUBSCRIBED") {
          console.log("[Real-time] Successfully subscribed to messages");
        } else if (status === "CHANNEL_ERROR") {
          console.error("[Real-time] Failed to subscribe to messages");
        }
      });

    channelsRef.current.push(channel);
  };

  const handleChatFileSelect = async () => {
    try {
      let result;

      // Try different approaches for file selection
      try {
        result = await DocumentPicker.getDocumentAsync({
          type: "*/*",
          copyToCacheDirectory: true,
          multiple: false,
        });
      } catch (firstError) {
        console.warn("First DocumentPicker approach failed:", firstError);
        // Fallback to more restrictive types
        result = await DocumentPicker.getDocumentAsync({
          type: [
            "image/*",
            "application/pdf",
            "text/plain",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          ],
          copyToCacheDirectory: true,
          multiple: false,
        });
      }

      if (!result.canceled && result.assets?.[0]) {
        const file = result.assets[0];
        console.log("Selected file:", file);

        // Extract first valid MIME type
        let mimeType = "application/octet-stream";

        // Try different properties that might contain the MIME type
        const possibleTypes = [
          file.type,
          file.mimeType,
          file.utis,
          file.mediaType,
        ].filter(Boolean);

        for (const type of possibleTypes) {
          if (typeof type === "string") {
            // Handle comma-separated MIME types
            const cleanType = type.split(",")[0].trim();
            // Validate MIME type format
            if (cleanType.includes("/") && cleanType.length > 3) {
              mimeType = cleanType;
              break;
            }
          } else if (Array.isArray(type) && type.length > 0) {
            // Handle array of MIME types
            const cleanType = type[0].split(",")[0].trim();
            if (cleanType.includes("/") && cleanType.length > 3) {
              mimeType = cleanType;
              break;
            }
          }
        }

        // Fallback: try to determine MIME type from file extension
        if (mimeType === "application/octet-stream" && file.name) {
          const ext = file.name.split(".").pop()?.toLowerCase();
          const extToMime = {
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            png: "image/png",
            gif: "image/gif",
            pdf: "application/pdf",
            txt: "text/plain",
            doc: "application/msword",
            docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          };
          if (extToMime[ext]) {
            mimeType = extToMime[ext];
          }
        }

        // Ensure file object has required properties
        const processedFile = {
          ...file,
          type: mimeType,
          name: file.name || `file_${Date.now()}`,
          size: file.size || 0,
        };
        setChatFile(processedFile);

        // Create preview for images
        if (mimeType && mimeType.startsWith("image/")) {
          setChatFilePreview(processedFile.uri);
        } else {
          setChatFilePreview(null);
        }
      }
    } catch (e) {
      console.error("File selection error:", e);
      showAlert("Error", e?.message || "Failed to select file");
    }
  };

  const sendMessage = async () => {
    if ((!newMessage.trim() && !chatFile) || messageSending) return;

    try {
      setMessageSending(true);
      let fileUrl = null;
      let chatFileName = null;
      let fileType = null;

      // Upload file if exists
      if (chatFile) {
        console.log("Starting file upload for:", chatFile);
        const fileExt = chatFile.name ? chatFile.name.split(".").pop() : "bin";
        const uploadFileName = `${Date.now()}.${fileExt}`;
        const filePath = `${gid}/chat/${uploadFileName}`;
        console.log("File path:", filePath);

        // Use the processed MIME type
        const mimeType = chatFile.type || "application/octet-stream";
        console.log("MIME type:", mimeType);

        // Upload to Supabase Storage - React Native approach
        let uploadData;
        let uploadError;

        if (Platform.OS === "web") {
          // Web approach - use fetch to get blob
          const response = await fetch(chatFile.uri);
          const blob = await response.blob();
          const result = await supabase.storage
            .from("chat-files")
            .upload(filePath, blob, {
              contentType: mimeType,
              upsert: false,
            });
          uploadData = result.data;
          uploadError = result.error;
        } else {
          // Native approach - manually upload using FileSystem to avoid JSON body issues with Supabase JS client
          const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
          const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

          if (!supabaseUrl || !supabaseAnonKey) {
            throw new Error("Missing Supabase configuration");
          }

          const { data: sessionData, error: sessionError } =
            await supabase.auth.getSession();
          if (sessionError || !sessionData?.session?.access_token) {
            throw new Error("Authentication required for upload");
          }

          const accessToken = sessionData.session.access_token;

          // Ensure we have a workable URI
          let fileUri = chatFile.uri;
          // Check for content URI which strictly requires copying if not already handled
          if (String(fileUri).startsWith("content://")) {
            try {
              const safeName = (chatFile.name || "file").replace(
                /[^a-zA-Z0-9.-]/g,
                "_",
              );
              const dest = `${cacheDirectory}${Date.now()}-${safeName}`;
              await FileSystemLegacy.copyAsync({ from: fileUri, to: dest });
              fileUri = dest;
            } catch (err) {
              console.warn("Failed to copy content URI, trying original:", err);
            }
          }

          const encodedObjectPath = filePath
            .split("/")
            .map((s) => encodeURIComponent(s))
            .join("/");
          const uploadUrl = `${supabaseUrl}/storage/v1/object/chat-files/${encodedObjectPath}`;

          const uploadType =
            typeof FileSystemUploadType?.BINARY_CONTENT === "number"
              ? FileSystemUploadType.BINARY_CONTENT
              : typeof FileSystemLegacy?.FileSystemUploadType
                    ?.BINARY_CONTENT === "number"
                ? FileSystemLegacy.FileSystemUploadType.BINARY_CONTENT
                : 0;

          try {
            const res = await FileSystemLegacy.uploadAsync(uploadUrl, fileUri, {
              httpMethod: "POST",
              uploadType,
              headers: {
                Authorization: `Bearer ${accessToken}`,
                apikey: supabaseAnonKey,
                "Content-Type": mimeType,
                "x-upsert": "false",
              },
            });

            if (res.status >= 200 && res.status < 300) {
              uploadData = { path: filePath };
              uploadError = null;
            } else {
              uploadError = {
                message: `Upload failed with status ${res.status}: ${res.body}`,
              };
            }
          } catch (e) {
            uploadError = e;
          }
        }

        if (uploadError) {
          console.error("File upload error:", uploadError);
          throw uploadError;
        }

        // Get public URL
        const {
          data: { publicUrl },
        } = supabase.storage.from("chat-files").getPublicUrl(filePath);

        if (!publicUrl) {
          throw new Error("Failed to get public URL for uploaded file");
        }

        fileUrl = publicUrl;
        chatFileName = chatFile.name || `file_${Date.now()}`;
        fileType = mimeType;
      }

      // Send message
      const { data, error } = await supabase
        .from("messages")
        .insert({
          group_id: gid,
          user_id: userData.id,
          user_name: userData.name,
          text: newMessage.trim() || null,
          file_url: fileUrl,
          file_name: chatFileName,
          file_type: fileType,
        })
        .select()
        .single();

      if (error) throw error;

      if (data) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === data.id)) return prev;
          return [...prev, data];
        });
      }

      setNewMessage("");
      clearChatFile();
    } catch (e) {
      showAlert("Error", e?.message || "Failed to send message");
    } finally {
      setMessageSending(false);
    }
  };

  const clearChatFile = () => {
    setChatFile(null);
    setChatFilePreview(null);
  };

  const deleteMessage = async (messageId) => {
    try {
      console.log("🗑️ Starting deletion for message:", messageId);

      // Step 1: Get message details to check for associated files
      const { data: messageData, error: fetchError } = await supabase
        .from("messages")
        .select("*")
        .eq("id", messageId)
        .single();

      if (fetchError) {
        console.error("❌ Failed to fetch message:", fetchError);
        throw fetchError;
      }

      if (!messageData) {
        console.log("⚠️ Message not found, removing from UI only");
        setMessages((prev) => prev.filter((msg) => msg.id !== messageId));
        return;
      }

      console.log("📄 Message data:", messageData);

      // Step 2: Delete associated file from storage if exists
      if (messageData.file_url && messageData.file_name) {
        try {
          // Extract file path from URL
          const urlParts = messageData.file_url.split("/");
          const fileName = urlParts[urlParts.length - 1];
          const filePath = `${gid}/chat/${fileName}`;

          console.log("🗂 Deleting file from storage:", filePath);

          const { error: storageError } = await supabase.storage
            .from("chat-files")
            .remove([filePath]);

          if (storageError) {
            console.error(
              "❌ Failed to delete file from storage:",
              storageError,
            );
            // Continue with message deletion even if file deletion fails
          } else {
            console.log("✅ File deleted from storage successfully");
          }
        } catch (fileError) {
          console.error("❌ File deletion error:", fileError);
          // Continue with message deletion
        }
      }

      // Step 3: Delete message from database
      console.log("🗑️ Deleting message from database...");
      const { error: deleteError } = await supabase
        .from("messages")
        .delete()
        .eq("id", messageId);

      if (deleteError) {
        console.error(
          "❌ Failed to delete message from database:",
          deleteError,
        );
        throw deleteError;
      }

      console.log("✅ Message deleted from database successfully");

      // Step 4: Remove from UI immediately
      setMessages((prev) => {
        const updatedMessages = prev.filter((msg) => msg.id !== messageId);
        console.log("🔄 Updated message count:", updatedMessages.length);
        return updatedMessages;
      });

      // Step 5: Verify deletion after a short delay
      setTimeout(async () => {
        try {
          const { data: verifyData, error: verifyError } = await supabase
            .from("messages")
            .select("id")
            .eq("id", messageId)
            .maybeSingle();

          if (verifyError) {
            console.error("❌ Verification error:", verifyError);
            return;
          }

          if (verifyData) {
            console.error(
              "❌ Message still exists after deletion, retrying...",
            );
            // Retry deletion once more
            await supabase.from("messages").delete().eq("id", messageId);

            // Remove from UI again
            setMessages((prev) => prev.filter((msg) => msg.id !== messageId));
          } else {
            console.log(
              "✅ Verification successful: Message permanently deleted",
            );
          }
        } catch (verifyErr) {
          console.error("❌ Verification process failed:", verifyErr);
        }
      }, 1000); // Verify after 1 second

      showAlert("Success", "Message deleted permanently");
    } catch (e) {
      console.error("❌ Delete message error:", e);
      showAlert("Error", e?.message || "Failed to delete message");
    }
  };

  const fetchFiles = async () => {
    try {
      console.log("[Files] Fetching fresh file list...");

      // 1. Fetch based on group_id - this is the source of truth
      const { data: filesData, error: dbError } = await supabase
        .from("files")
        .select("*")
        .eq("group_id", gid)
        .order("created_at", { ascending: false });

      if (dbError) throw dbError;

      if (!filesData || filesData.length === 0) {
        console.log("[Files] No files found in database");
        setFiles([]);
        return;
      }

      console.log("[Files] Found files in database:", filesData.length);

      // 2. Map to local structure and ensure no duplicates by ID
      const paths = [...new Set(filesData.map((f) => f.path))];
      const { data: signedData } = await supabase.storage
        .from("group-files")
        .createSignedUrls(paths, 3600);

      const urlMap = {};
      if (signedData) {
        signedData.forEach((item) => {
          if (item.path && item.signedUrl) {
            urlMap[item.path] = item.signedUrl;
          }
        });
      }

      const mapped = filesData.map((f) => ({
        id: f.id,
        name: f.name,
        path: f.path,
        url: urlMap[f.path] || "",
        uploadedBy: f.uploaded_by,
        uploadedByName: f.uploaded_by_name,
        uploadedAt: f.created_at,
      }));

      // 3. Filter out files that have been marked as deleted (fallback mechanism)
      // This prevents files that failed to delete from database from reappearing
      const filteredMapped = mapped.filter(
        (f) => !deletedFileIds.has(String(f.id)),
      );

      console.log("[Files] Setting files to display:", filteredMapped.length);
      console.log(
        "[Files] Files being set:",
        filteredMapped.map((f) => ({ id: f.id, name: f.name })),
      );

      // 4. Force UI update with a new array reference
      setFiles([]);
      setTimeout(() => {
        setFiles([...filteredMapped]);
      }, 50);
    } catch (e) {
      console.error("fetchFiles error:", e);
      showAlert("Files", "Could not refresh file list");
    }
  };

  const subscribeFiles = async () => {
    const channel = supabase
      .channel(`files:group:${gid}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "files",
          filter: `group_id=eq.${gid}`,
        },
        () => {
          fetchFiles();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "files",
          filter: `group_id=eq.${gid}`,
        },
        () => {
          fetchFiles();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "files",
          filter: `group_id=eq.${gid}`,
        },
        (payload) => {
          console.log("[Real-time] File deleted:", payload.old?.id);
          // Remove from UI immediately when database deletion is confirmed
          const deletedId = String(payload.old?.id);

          // Remove from deleted tracking in-memory
          setDeletedFileIds((prev) => {
            const newSet = new Set(prev);
            newSet.delete(deletedId);
            return newSet;
          });

          setFiles((prev) => prev.filter((f) => String(f.id) !== deletedId));
        },
      )
      .subscribe();
    channelsRef.current.push(channel);
  };

  const uploadFile = async () => {
    try {
      if (userData?.role !== "teacher") {
        showAlert("Not allowed", "Only teachers can upload files.");
        return;
      }

      if (!gid) {
        showAlert("Upload Error", "Missing group id");
        return;
      }

      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;

      const file = result.assets?.[0];
      if (!file?.uri) {
        showAlert("Upload Error", "No valid file selected");
        return;
      }

      const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

      const sanitizeFileName = (value) => {
        const fallback = "file";
        const raw =
          typeof value === "string" && value.trim().length > 0
            ? value.trim()
            : fallback;
        const noPath = raw.replace(/[/\\]/g, "_");
        const safe = noPath.replace(/[^a-zA-Z0-9._()\-\s]/g, "_");
        return safe.length > 180 ? safe.slice(0, 180) : safe;
      };

      const name = sanitizeFileName(file.name || "file");
      const mimeType = file.mimeType || "application/octet-stream";
      const path = `${gid}/${Date.now()}-${name}`;

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError || !user) {
        showAlert("Upload failed", userError?.message || "User not logged in");
        return;
      }

      setUploading(true);
      try {
        const rollbackStorageObject = async () => {
          try {
            await supabase.storage.from("group-files").remove([path]);
          } catch (e) {
            console.error("[Upload] Rollback remove failed:", e);
          }
        };

        if (Platform.OS === "web") {
          const response = await fetch(file.uri);
          if (!response.ok) {
            throw new Error(
              `Failed to read selected file (status ${response.status})`,
            );
          }
          const blob = await response.blob();
          if (!blob) {
            throw new Error("Failed to create file blob");
          }
          if (
            typeof blob.size === "number" &&
            blob.size > MAX_FILE_SIZE_BYTES
          ) {
            showAlert("Upload Error", "File is too large (max 50MB).");
            return;
          }

          const { error: uploadError } = await supabase.storage
            .from("group-files")
            .upload(path, blob, { contentType: mimeType, upsert: false });
          if (uploadError) throw uploadError;
        } else {
          const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
          const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
          if (!supabaseUrl || !supabaseAnonKey) {
            throw new Error("Missing Supabase env vars");
          }

          let fileUri = file.uri;
          if (String(fileUri).startsWith("content://")) {
            const dest = `${cacheDirectory}${Date.now()}-${name}`;
            await FileSystemLegacy.copyAsync({ from: fileUri, to: dest });
            fileUri = dest;
          }

          const info = await FileSystemLegacy.getInfoAsync(fileUri, {
            size: true,
          });
          if (!info?.exists) {
            showAlert("Upload Error", "Selected file is not accessible");
            return;
          }
          if (
            typeof info.size === "number" &&
            info.size > MAX_FILE_SIZE_BYTES
          ) {
            showAlert("Upload Error", "File is too large (max 50MB).");
            return;
          }

          const { data: sessionData, error: sessionError } =
            await supabase.auth.getSession();
          if (sessionError) throw sessionError;
          const accessToken = sessionData?.session?.access_token;
          if (!accessToken) {
            throw new Error("Not authenticated");
          }

          const encodedObjectPath = path
            .split("/")
            .map((segment) => encodeURIComponent(segment))
            .join("/");
          const uploadUrl = `${supabaseUrl}/storage/v1/object/group-files/${encodedObjectPath}`;

          const uploadType =
            typeof FileSystemUploadType?.BINARY_CONTENT === "number"
              ? FileSystemUploadType.BINARY_CONTENT
              : typeof FileSystemLegacy?.FileSystemUploadType
                    ?.BINARY_CONTENT === "number"
                ? FileSystemLegacy.FileSystemUploadType.BINARY_CONTENT
                : 0;

          const res = await FileSystemLegacy.uploadAsync(uploadUrl, fileUri, {
            httpMethod: "POST",
            uploadType,
            headers: {
              Authorization: `Bearer ${accessToken}`,
              apikey: supabaseAnonKey,
              "Content-Type": mimeType,
              "x-upsert": "false",
            },
          });

          if (!res || res.status < 200 || res.status >= 300) {
            throw new Error(
              res?.body ||
                `Upload failed with status ${res?.status ?? "unknown"}`,
            );
          }
        }

        const { error: dbError } = await supabase.from("files").insert({
          group_id: gid,
          name,
          path,
          uploaded_by: user.id,
          uploaded_by_name:
            user.user_metadata?.name || user.email || "Unknown User",
        });

        if (dbError) {
          await rollbackStorageObject();
          throw dbError;
        }

        await fetchFiles();
        showAlert("Success", "File uploaded!");
      } finally {
        setUploading(false);
      }
    } catch (err) {
      showAlert("Upload Error", err?.message || "Unknown error");
    }
  };

  const verifyFileDeletion = async (fileId, filePath) => {
    try {
      console.log("[FileDelete] Verifying complete deletion...");

      // Check if file still exists in database with retry logic
      let dbFile = null;
      let dbError = null;
      let existsInDB = false;

      // Try database check up to 3 times with delays
      for (let attempt = 1; attempt <= 3; attempt++) {
        console.log(`[FileDelete] Database verification attempt ${attempt}/3`);

        const { data: dbCheck, error: checkError } = await supabase
          .from("files")
          .select("id")
          .eq("id", fileId)
          .maybeSingle();

        dbError = checkError;
        dbFile = dbCheck;
        existsInDB = !checkError && !!dbCheck;

        if (!existsInDB || dbError) {
          console.log(
            "[FileDelete] File not found in database or error occurred",
          );
          break;
        }

        // If file still exists and this isn't the last attempt, wait and retry
        if (existsInDB && attempt < 3) {
          console.log(
            "[FileDelete] File still exists, waiting before retry...",
          );
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      // Check if file still exists in storage
      let existsInStorage = false;
      let storageError = null;

      if (filePath) {
        try {
          const { data, error } = await supabase.storage
            .from("group-files")
            .list(filePath.split("/")[0], {
              search: filePath.split("/").pop(),
              limit: 1,
            });

          existsInStorage = !error && data && data.length > 0;
          if (error) storageError = error;
        } catch (err) {
          storageError = err;
        }
      }

      console.log("[FileDelete] Final verification result:", {
        existsInDB,
        existsInStorage,
        dbError,
        storageError,
        attempts: 3,
      });

      return {
        completelyDeleted: !existsInDB && !existsInStorage,
        existsInDB,
        existsInStorage,
        dbError,
        storageError,
      };
    } catch (err) {
      console.error("[FileDelete] Verification error:", err);
      return {
        completelyDeleted: false,
        existsInDB: true,
        existsInStorage: true,
        error: err,
      };
    }
  };

  const deleteFile = async (file) => {
    // Check permissions first
    if (userData?.role !== "teacher") {
      showAlert("Not allowed", "Only teachers can delete files.");
      return;
    }

    // Show confirmation dialog
    showAlert(
      "Delete File",
      `Are you sure you want to delete "${file.name}"? This action cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => performFileDeletion(file),
        },
      ],
    );
  };

  const performFileDeletion = async (file) => {
    // Set loading state for this specific file
    setDeleteLoading((prev) => ({ ...prev, [file.id]: true }));

    try {
      console.log("[FileDelete] Starting deletion for file:", {
        id: file.id,
        name: file.name,
        path: file.path,
      });

      // Step 1: Remove from UI immediately for better UX
      const originalFiles = [...files];
      console.log("[FileDelete] Removing file from UI immediately:", file.id);
      console.log(
        "[FileDelete] Current files before removal:",
        files.map((f) => ({ id: f.id, name: f.name })),
      );

      // Force immediate UI update
      setFiles((prev) => {
        const filtered = prev.filter((f) => String(f.id) !== String(file.id));
        console.log(
          "[FileDelete] Files after filter:",
          filtered.map((f) => ({ id: f.id, name: f.name })),
        );
        return filtered;
      });

      // Also add to deleted tracking immediately
      setDeletedFileIds((prev) => {
        const newSet = new Set([...prev, String(file.id)]);
        console.log("[FileDelete] Added to deleted tracking:", String(file.id));
        return newSet;
      });

      // Step 2: Delete file from Storage & Database using Dashboard pattern
      let storageDeleted = false;
      let storageError = null;
      let databaseDeleted = false;
      let databaseError = null;

      // Delete from storage first
      if (file.path) {
        try {
          console.log("[FileDelete] Deleting from storage bucket:", file.path);
          const { error, data } = await supabase.storage
            .from("group-files")
            .remove([file.path]);

          if (error) {
            console.error("[FileDelete] Storage deletion failed:", error);
            storageError = error;
          } else {
            console.log("[FileDelete] Storage deletion successful:", data);
            storageDeleted = true;
          }
        } catch (err) {
          console.error("[FileDelete] Storage deletion exception:", err);
          storageError = err;
        }
      }

      // Delete from database
      try {
        console.log("[FileDelete] Deleting from database:", file.id);
        const { error, data } = await supabase
          .from("files")
          .delete()
          .eq("id", file.id)
          .select();

        if (error) {
          console.error("[FileDelete] Database deletion failed:", error);
          databaseError = error;

          // Try soft delete as fallback
          console.log("[FileDelete] Attempting soft delete as fallback");
          const { error: softError, data: softData } = await supabase
            .from("files")
            .update({
              deleted: true,
              deleted_at: new Date().toISOString(),
              deleted_by: userData.id,
            })
            .eq("id", file.id)
            .select();

          if (softError) {
            console.error("[FileDelete] Soft delete also failed:", softError);
            databaseError = softError;
          } else {
            console.log("[FileDelete] Soft delete successful:", softData);
            databaseDeleted = true;
          }
        } else {
          console.log("[FileDelete] Database deletion successful:", data);
          databaseDeleted = true;
        }
      } catch (err) {
        console.error("[FileDelete] Database deletion exception:", err);
        databaseError = err;
      }

      // Step 3: Determine success and show appropriate message
      if (databaseDeleted && (storageDeleted || !file.path)) {
        showAlert(
          "Success",
          "File permanently deleted from Supabase storage and database.",
        );
        console.log("[FileDelete] Complete deletion successful");
      } else if (databaseDeleted && !storageDeleted && file.path) {
        showAlert(
          "Partial Success",
          "File deleted from database but storage cleanup failed. File may still exist in bucket.",
        );
        console.log(
          "[FileDelete] Database deletion successful, storage failed",
        );
      } else if (!databaseDeleted && storageDeleted) {
        showAlert(
          "Partial Success",
          "File deleted from storage but database cleanup failed. File may reappear in list.",
        );
        console.log(
          "[FileDelete] Storage deletion successful, database failed",
        );
      } else {
        // Both failed - restore file to UI
        setFiles(originalFiles);

        // Create detailed error message
        let errorMessage = "Failed to delete file";
        const errors = [];

        if (databaseError) {
          errors.push(`Database: ${databaseError.message || databaseError}`);
        }

        if (storageError) {
          errors.push(`Storage: ${storageError.message || storageError}`);
        }

        if (errors.length > 0) {
          errorMessage = `Failed to delete file: ${errors.join("; ")}`;
        }

        showAlert("Error", errorMessage);
        console.error("[FileDelete] Complete deletion failed:", {
          storageError,
          databaseError,
        });
        return;
      }

      // Step 4: Clean up local tracking if deletion was successful
      if (databaseDeleted) {
        // Remove from deleted files tracking
        setDeletedFileIds((prev) => {
          const newSet = new Set(prev);
          newSet.delete(String(file.id));
          return newSet;
        });
      }

      // Step 5: Force immediate file list refresh to ensure UI is in sync
      console.log("[FileDelete] Refreshing file list immediately...");

      // Force refresh multiple times to ensure UI update
      await fetchFiles();

      // Additional refresh after short delay
      setTimeout(async () => {
        console.log("[FileDelete] Performing additional refresh...");
        await fetchFiles();
      }, 300);

      // Final refresh after real-time updates
      setTimeout(async () => {
        console.log("[FileDelete] Final refresh for real-time sync...");
        await fetchFiles();
      }, 1000);
    } catch (err) {
      console.error("[FileDelete] Unexpected error:", err);
      showAlert(
        "Error",
        "An unexpected error occurred while deleting the file.",
      );
    } finally {
      // Clear loading state
      setDeleteLoading((prev) => ({ ...prev, [file.id]: false }));
    }
  };

  const fetchSessions = async () => {
    try {
      const { data, error } = await supabase
        .from("sessions")
        .select("*")
        .eq("group_id", gid)
        .order("start_time", { ascending: true });

      if (error) throw error;
      const list = data || [];
      setSessions(list);
      list.forEach((s) => {
        if (s.recording_path) {
          loadRecordingUrl(s);
        }
      });
    } catch (e) {
      showAlert("Sessions", e?.message || "Failed to load sessions");
    }
  };

  const subscribeSessions = async () => {
    const channel = supabase
      .channel(`sessions:group:${gid}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "sessions",
          filter: `group_id=eq.${gid}`,
        },
        (payload) => {
          setSessions((prev) => {
            if (prev.some((s) => s.id === payload.new.id)) return prev;
            return [...prev, payload.new];
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "sessions",
          filter: `group_id=eq.${gid}`,
        },
        (payload) => {
          setSessions((prev) =>
            prev.map((s) =>
              s.id === payload.new.id ? { ...s, ...payload.new } : s,
            ),
          );
          if (payload.new?.recording_path) {
            loadRecordingUrl(payload.new);
          }
        },
      )
      .subscribe();

    channelsRef.current.push(channel);
  };

  const createSession = async () => {
    if (!sessionTitle.trim() || !sessionDescription.trim()) {
      showAlert("Missing info", "Please provide title and description.");
      return;
    }

    if (sessionStartTime.getTime() <= Date.now()) {
      showAlert("Invalid date", "Start time must be in the future.");
      return;
    }

    try {
      setSessionLoading(true);
      const { data, error } = await supabase
        .from("sessions")
        .insert({
          group_id: gid,
          title: sessionTitle.trim(),
          description: sessionDescription.trim(),
          start_time: sessionStartTime.toISOString(),
          created_by: userData.id,
          created_by_name: userData.name,
        })
        .select()
        .single();

      if (error) throw error;

      if (data) {
        setSessions((prev) => {
          if (prev.some((s) => s.id === data.id)) return prev;
          return [...prev, data];
        });
      }

      setSessionTitle("");
      setSessionDescription("");
      setSessionStartTime(new Date());

      // Trigger email notification (fire and forget)
      if (data) {
        // Format time for email
        const formattedTime = new Date(data.start_time).toLocaleString(
          "en-US",
          {
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            timeZoneName: "short",
          },
        );

        supabase.functions
          .invoke("notify-group-session", {
            body: {
              topic: data.title,
              startTime: data.start_time,
              formattedTime: formattedTime,
              groupId: gid,
              groupName: group.name,
            },
          })
          .then(({ data, error }) => {
            if (error) {
              console.error("Failed to send notifications:", error);
              // Optional: alert user that emails failed to send
            } else {
              console.log("Notification result:", data);
              showAlert(
                "Success",
                "Session scheduled and email notifications sent!",
              );
            }
          });
      }
    } catch (e) {
      showAlert("Error", e?.message || "Failed to create session");
    } finally {
      setSessionLoading(false);
    }
  };

  const startRecording = async (session) => {
    try {
      if (isProcessingRecording) return;
      if (recording) {
        showAlert("Recording", "A recording is already in progress.");
        return;
      }

      const perm = await Audio.requestPermissionsAsync();
      if (!perm?.granted) {
        showAlert(
          "Permission needed",
          "Microphone permission is required to record audio.",
        );
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording: rec } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );

      setRecording(rec);
      setRecordingSessionId(session.id);
    } catch (e) {
      showAlert("Recording failed", e?.message || "Failed to start recording");
      setRecording(null);
      setRecordingSessionId(null);
    }
  };

  const stopRecording = async () => {
    if (!recording || !recordingSessionId) return;

    try {
      setIsProcessingRecording(true);
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      if (!uri) throw new Error("No recording file found");

      const session = sessions.find((s) => s.id === recordingSessionId);
      if (!session) throw new Error("Session not found for recording");

      const ext = uri.endsWith(".m4a")
        ? "m4a"
        : uri.endsWith(".caf")
          ? "caf"
          : uri.endsWith(".3gp")
            ? "3gp"
            : "m4a";
      const contentType =
        ext === "3gp"
          ? "audio/3gpp"
          : ext === "caf"
            ? "audio/x-caf"
            : "audio/m4a";

      const fileName = `${session.id}-${Date.now()}.${ext}`;
      const storagePath = `${gid}/${fileName}`;

      let recording_path = "";

      if (Platform.OS === "web") {
        const blob = await fetch(uri).then((r) => r.blob());
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from("session-recordings")
          .upload(storagePath, blob, {
            contentType,
            upsert: true,
          });
        if (uploadError) throw uploadError;
        recording_path = uploadData?.path || storagePath;
      } else {
        // Native upload using FileSystem
        const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
        const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

        if (!supabaseUrl || !supabaseAnonKey) {
          throw new Error("Supabase config missing for native upload");
        }

        const { data: sessionData, error: sessionError } =
          await supabase.auth.getSession();
        if (sessionError || !sessionData?.session?.access_token) {
          throw new Error("Auth session missing for upload");
        }

        const accessToken = sessionData.session.access_token;
        const encodedPath = storagePath
          .split("/")
          .map((s) => encodeURIComponent(s))
          .join("/");
        const uploadUrl = `${supabaseUrl}/storage/v1/object/session-recordings/${encodedPath}`;

        const uploadType =
          typeof FileSystemUploadType?.BINARY_CONTENT === "number"
            ? FileSystemUploadType.BINARY_CONTENT
            : typeof FileSystemLegacy?.FileSystemUploadType?.BINARY_CONTENT ===
                "number"
              ? FileSystemLegacy.FileSystemUploadType.BINARY_CONTENT
              : 0;

        const res = await FileSystemLegacy.uploadAsync(uploadUrl, uri, {
          httpMethod: "POST",
          uploadType,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            apikey: supabaseAnonKey,
            "Content-Type": contentType,
            "x-upsert": "true",
          },
        });

        if (res.status >= 200 && res.status < 300) {
          recording_path = storagePath;
        } else {
          throw new Error(
            `Upload failed with status ${res.status}: ${res.body}`,
          );
        }
      }

      // const blob = await fetch(uri).then((r) => r.blob()); <- REMOVED
      // ... Supabase upload logic ... <- REMOVED

      const { data: updatedPath, error: updatePathError } = await supabase
        .from("sessions")
        .update({
          recording_path,
          recording_uploaded_at: new Date().toISOString(),
        })
        .eq("id", session.id)
        .select()
        .single();

      if (updatePathError) throw updatePathError;

      const updatedSession = updatedPath || { ...session, recording_path };
      await loadRecordingUrl(updatedSession);

      const { data: signedData, error: signedError } = await supabase.storage
        .from("session-recordings")
        .createSignedUrl(recording_path, 3600);
      if (signedError) throw signedError;
      const signedUrl = signedData?.signedUrl || "";
      if (signedUrl) {
        setRecordingUrls((prev) => ({ ...prev, [session.id]: signedUrl }));
      }

      const transcript = await transcribeRecording(undefined, signedUrl);
      let ai_summary = "";
      try {
        ai_summary = await generateSummary(transcript || "");
      } catch {
        ai_summary = "Summary could not be generated.";
      }

      const { error: updateError } = await supabase
        .from("sessions")
        .update({
          transcript: transcript || "",
          ai_summary,
          recording_path,
        })
        .eq("id", session.id);
      if (updateError) throw updateError;

      showAlert(
        "Saved",
        "Recording uploaded, transcript saved, and AI summary generated.",
      );
      await fetchSessions();
    } catch (e) {
      showAlert(
        "Recording failed",
        e?.message || "Failed to process recording",
      );
    } finally {
      try {
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      } catch {
        // ignore
      }
      setIsProcessingRecording(false);
      setRecording(null);
      setRecordingSessionId(null);
    }
  };

  const generateSummaryFromRecording = async (session) => {
    try {
      if (!session?.recording_path) {
        showAlert("No recording", "No recording found for this session.");
        return;
      }

      setSummaryLoading((prev) => ({ ...prev, [session.id]: true }));

      const { data, error } = await supabase.storage
        .from("session-recordings")
        .createSignedUrl(session.recording_path, 3600);
      if (error) throw error;
      const signedUrl = data?.signedUrl || "";
      if (!signedUrl) throw new Error("Could not create signed URL");

      setRecordingUrls((prev) => ({ ...prev, [session.id]: signedUrl }));

      const transcript = await transcribeRecording(undefined, signedUrl);
      let ai_summary = "";
      try {
        ai_summary = await generateSummary(transcript || "");
      } catch {
        ai_summary = "Summary could not be generated.";
      }

      const { error: updateError } = await supabase
        .from("sessions")
        .update({
          transcript: transcript || session.transcript || "",
          ai_summary,
          recording_path: session.recording_path,
        })
        .eq("id", session.id);
      if (updateError) throw updateError;

      await fetchSessions();
      showAlert("Done", "AI summary generated from recording.");
    } catch (e) {
      showAlert("Error", e?.message || "Failed to generate summary");
    } finally {
      setSummaryLoading((prev) => ({ ...prev, [session.id]: false }));
    }
  };

  const getJitsiPublicUrl = (session) => {
    const meetingId =
      session.id || session.meeting_id || "meeting-" + Date.now();
    return `https://meet.jit.si/${meetingId}`;
  };

  /* ---------------- Password Verification ---------------- */
  const verifySessionPassword = async (password) => {
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

  const deleteLiveMeeting = (session) => {
    const isTeacher = group?.created_by === userData?.id;
    if (!isTeacher) {
      showAlert("Not allowed", "Only teacher can delete sessions.");
      return;
    }

    // If user is a teacher, require password confirmation
    if (userData.role === "teacher") {
      setSessionToDelete(session);
      setShowSessionPasswordModal(true);
      return;
    }

    // For non-teachers, proceed with normal deletion flow
    confirmDeleteSession(session);
  };

  const confirmDeleteSession = async (session) => {
    showAlert("Delete session?", `Delete session "${session.title}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            // 1. Cleanup recording from storage if it exists
            if (session.recording_path) {
              await supabase.storage
                .from("session-recordings")
                .remove([session.recording_path]);
            }

            // 2. Delete from DB
            const { error } = await supabase
              .from("sessions")
              .delete()
              .eq("id", session.id);
            if (error) throw error;

            setSessions((prev) => prev.filter((s) => s.id !== session.id));
            showAlert(
              "Deleted",
              "Session and recording removed from Supabase.",
            );
          } catch (e) {
            console.error("Session delete failed:", e);
            showAlert(
              "Delete failed",
              e?.message || "Failed to delete session",
            );
          }
        },
      },
    ]);
  };

  const handleSessionPasswordConfirm = async () => {
    if (!sessionDeletePassword.trim()) {
      setSessionDeleteError("Password is required");
      return;
    }

    const isValidPassword = await verifySessionPassword(sessionDeletePassword);

    if (!isValidPassword) {
      setSessionDeleteError("Incorrect password");
      return;
    }

    // Password is correct, proceed with deletion
    setShowSessionPasswordModal(false);
    setSessionDeletePassword("");
    setSessionDeleteError("");

    if (sessionToDelete) {
      confirmDeleteSession(sessionToDelete);
    }
  };

  const handleSessionPasswordCancel = () => {
    setShowSessionPasswordModal(false);
    setSessionDeletePassword("");
    setSessionToDelete(null);
    setSessionDeleteError("");
  };

  const submitJoinDetails = async () => {
    if (!joinName.trim() || !joinRoleNo.trim()) {
      showAlert("Missing Info", "Please enter both Name and Roll Number.");
      return;
    }

    try {
      // Record attendance
      const { error } = await supabase.from("session_attendance").insert({
        session_id: joiningSession.id,
        user_id: userData?.id,
        student_name: joinName,
        role_number: joinRoleNo,
      });

      if (error) {
        console.error("Attendance insert error:", error);
        showAlert("Error", "Failed to record attendance: " + error.message);
        return;
      }

      setShowJoinModal(false);

      // Open the meeting
      if (joiningSession) {
        Linking.openURL(getJitsiPublicUrl(joiningSession));
      }

      setJoinName("");
      setJoinRoleNo("");
      setJoiningSession(null);
    } catch (error) {
      console.error("Join error:", error);
      showAlert("Error", "An error occurred. Please try again.");
    }
  };

  const viewAttendance = async (session) => {
    setViewingAttendanceSession(session);
    setShowAttendanceModal(true);
    setLoadingAttendance(true);
    setAttendanceList([]);

    try {
      const { data, error } = await supabase
        .from("session_attendance")
        .select("*")
        .eq("session_id", session.id)
        .order("joined_at", { ascending: false });

      if (error) throw error;
      setAttendanceList(data || []);
    } catch (error) {
      console.error("Fetch attendance error:", error);
      showAlert("Error", "Failed to load attendance records.");
    } finally {
      setLoadingAttendance(false);
    }
  };

  const handleJoinSession = async (session) => {
    const isTeacher =
      group?.created_by === userData?.id || userData?.role === "teacher";

    if (isTeacher) {
      // If already recording this session, just join
      if (recording && recordingSessionId === session.id) {
        Linking.openURL(getJitsiPublicUrl(session));
        return;
      }

      // If recording another session
      if (recording) {
        showAlert(
          "Recording in progress",
          "Please stop the current recording first.",
        );
        return;
      }

      // Start recording implies we are the host starting the session
      // Wait, let's not auto-start recording on join for now to match web behavior more closely if needed.
      // But keeping existing logic: if teacher joins, they might want to record.
      // The web version separates "Join" and "Record". Here it seems combined or inferred.
      // Re-reading web code: Web has separate "Join Live Meeting" and "Record Session" buttons.
      // Here in mobile, we have "Join Live" button calling this function.

      // Let's just open the URL for teachers directly, as per web behavior.
      Linking.openURL(getJitsiPublicUrl(session));
    } else {
      // Student: Show join modal
      setJoiningSession(session);
      setJoinName(userData?.name || "");
      setShowJoinModal(true);
    }
  };

  const handleDownloadFile = async (file) => {
    if (!file?.url) {
      showAlert("Download", "No file URL available");
      return;
    }

    if (Platform.OS === "web") {
      Linking.openURL(file.url);
    } else {
      try {
        const fileUri = FileSystemLegacy.documentDirectory + file.name;
        const { uri } = await FileSystemLegacy.downloadAsync(file.url, fileUri);

        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri);
        } else {
          showAlert("Download", "Sharing not available on this device");
        }
      } catch (e) {
        console.error(e);
        showAlert("Download", "Failed to download file");
      }
    }
  };

  const loadFileForAI = async (file) => {
    if (!file?.url) {
      showAlert("AI", "No file URL available");
      return;
    }

    setAiLoading(true);
    setAiResult(null);
    try {
      // Use the Headless Parser for robust extraction on all platforms
      if (parserRef.current) {
        const txt = await parserRef.current.parseFile(file.url, file.name);
        setAiContent(txt);
        setActiveTab(TAB_FILES);
        showAlert("AI Ready", "File content loaded! Check the AI tab below.");
      } else {
        // Fallback for some reason if ref is missing
        const txt = await extractTextFromFile(file.url);
        if (!txt) {
          showAlert("AI", "Could not extract text from this file.");
          return;
        }
        setAiContent(txt);
        setActiveTab(TAB_FILES);
        showAlert("AI Ready", "File content loaded! Check the AI tab below.");
      }
    } catch (e) {
      console.error("Extraction error:", e);
      showAlert("AI", e?.message || "Failed to load file content");
    } finally {
      setAiLoading(false);
    }
  };

  const clearAIContent = () => {
    setAiContent("");
    setAiResult(null);
    // Reset quiz state when clearing content
    setQuizSelections({});
    setQuizRevealed({});
    setQuizSubmitted(false);
    showAlert("AI", "Content cleared");
  };

  const handleQuizOptionClick = (questionIndex, optionIndex) => {
    // Only record the user's selection, don't reveal answers yet
    setQuizSelections((prev) => ({
      ...prev,
      [questionIndex]: optionIndex,
    }));
  };

  const resetQuiz = () => {
    // Generate a completely new quiz with different questions
    setAiLoading(true);
    setAiResult(null);

    (async () => {
      try {
        const quiz = await generateQuiz(aiContent);

        if (!Array.isArray(quiz) || quiz.length === 0) {
          throw new Error(
            "No quiz questions were generated. Please try with different content.",
          );
        }

        setAiResult({ type: "quiz", content: quiz });
        setQuizSelections({});
        setQuizRevealed({});
        setQuizSubmitted(false);
        showAlert("New Quiz", "Fresh quiz questions generated!");
      } catch (e) {
        console.error("[AI] Quiz regeneration error:", e);
        showAlert("AI", e?.message || "Failed to generate new quiz");
      } finally {
        setAiLoading(false);
      }
    })();
  };

  const handleSubmitQuiz = () => {
    // Reveal all answers when quiz is submitted
    const allQuestionsRevealed = {};
    if (aiResult?.type === "quiz" && Array.isArray(aiResult.content)) {
      aiResult.content.forEach((_, index) => {
        allQuestionsRevealed[index] = true;
      });
    }
    setQuizRevealed(allQuestionsRevealed);
    setQuizSubmitted(true);
  };

  const calculateQuizScore = () => {
    if (aiResult?.type !== "quiz" || !Array.isArray(aiResult.content)) return 0;

    return Object.entries(quizSelections).filter(
      ([questionIndex, selectedOption]) => {
        const question = aiResult.content[parseInt(questionIndex)];
        return question && question.correctAnswer === selectedOption;
      },
    ).length;
  };

  const handleAISummary = async () => {
    if (!aiContent.trim()) {
      showAlert("AI", "Paste content or select a file first");
      return;
    }

    setAiLoading(true);
    setAiResult(null);
    try {
      const summary = await generateSummary(aiContent);
      setAiResult({ type: "summary", content: summary });
    } catch (e) {
      showAlert("AI", e?.message || "Failed to generate summary");
    } finally {
      setAiLoading(false);
    }
  };

  const handleAIFlashcards = async () => {
    if (!aiContent.trim()) {
      showAlert("AI", "Paste content or select a file first");
      return;
    }

    setAiLoading(true);
    setAiResult(null);
    try {
      console.log("[AI] Starting flashcard generation...");
      const flashcards = await generateFlashcards(aiContent);
      console.log("[AI] Flashcards generated:", flashcards);

      if (!Array.isArray(flashcards) || flashcards.length === 0) {
        throw new Error(
          "No flashcards were generated. Please try with different content.",
        );
      }

      setAiResult({ type: "flashcards", content: flashcards });
      console.log("[AI] Flashcards set in result state");
    } catch (e) {
      console.error("[AI] Flashcard generation error:", e);
      showAlert("AI", e?.message || "Failed to generate flashcards");
    } finally {
      setAiLoading(false);
    }
  };

  const handleAIQuiz = async () => {
    if (!aiContent.trim()) {
      showAlert("AI", "Paste content or select a file first");
      return;
    }

    setAiLoading(true);
    setAiResult(null);
    try {
      console.log("[AI] Starting quiz generation...");
      const quiz = await generateQuiz(aiContent);
      console.log("[AI] Quiz generated:", quiz);

      if (!Array.isArray(quiz) || quiz.length === 0) {
        throw new Error(
          "No quiz questions were generated. Please try with different content.",
        );
      }

      setAiResult({ type: "quiz", content: quiz });
      console.log("[AI] Quiz set in result state");
    } catch (e) {
      console.error("[AI] Quiz generation error:", e);
      showAlert("AI", e?.message || "Failed to generate quiz");
    } finally {
      setAiLoading(false);
    }
  };

  const tutorSend = async () => {
    if (!tutorInput.trim() || tutorLoading) return;

    const nextMessages = [
      ...tutorMessages,
      { role: "user", content: tutorInput.trim() },
    ];
    setTutorMessages(nextMessages);
    setTutorInput("");

    try {
      setTutorLoading(true);
      const reply = await chatWithTutor(nextMessages);
      setTutorMessages((prev) => [...prev, reply]);
    } catch (e) {
      showAlert("Tutor", e?.message || "Failed to get response");
    } finally {
      setTutorLoading(false);
    }
  };

  const headerTitle = useMemo(() => {
    if (!group) return "Study Group";
    return group.name;
  }, [group]);

  useEffect(() => {
    if (!userData) {
      setTimeout(() => router.replace("/welcome"), 0);
      return;
    }
  }, [userData]);

  useEffect(() => {
    if (!gid) {
      setTimeout(() => router.replace("/dashboard"), 0);
      return;
    }
  }, [gid]);

  // Real-time Attendance Subscription
  useEffect(() => {
    let subscription;

    if (showAttendanceModal && viewingAttendanceSession) {
      const channel = supabase
        .channel(`attendance:${viewingAttendanceSession.id}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "session_attendance",
            filter: `session_id=eq.${viewingAttendanceSession.id}`,
          },
          (payload) => {
            console.log("New attendance:", payload.new);
            setAttendanceList((prev) => [payload.new, ...prev]);
          },
        )
        .subscribe();

      subscription = channel;
    }

    return () => {
      if (subscription) {
        supabase.removeChannel(subscription);
      }
    };
  }, [showAttendanceModal, viewingAttendanceSession]);

  if (!userData || !gid) {
    return null;
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.groupTitle} numberOfLines={1}>
            {headerTitle}
          </Text>
          <Text style={styles.groupSub}>
            {group?.membersCount ?? 0} members
          </Text>
        </View>
      </View>

      <TouchableOpacity
        style={styles.groupIdCard}
        onPress={copyGroupId}
        activeOpacity={0.8}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.groupIdLabel}>Group ID (tap to copy)</Text>
          <Text style={styles.groupIdValue} numberOfLines={1}>
            {gid}
          </Text>
        </View>
        <View style={styles.copyChip}>
          <Text style={styles.copyChipText}>Copy</Text>
        </View>
      </TouchableOpacity>

      <View style={styles.tabs}>
        <Tab
          label="Chat"
          active={activeTab === TAB_CHAT}
          onPress={() => setActiveTab(TAB_CHAT)}
        />
        <Tab
          label="Files"
          active={activeTab === TAB_FILES}
          onPress={() => setActiveTab(TAB_FILES)}
        />
        <Tab
          label="Sessions"
          active={activeTab === TAB_SESSIONS}
          onPress={() => setActiveTab(TAB_SESSIONS)}
        />
        <Tab
          label="AI Tutor"
          active={activeTab === TAB_AI}
          onPress={() => setActiveTab(TAB_AI)}
        />
      </View>

      {activeTab === TAB_CHAT && (
        <View style={styles.body}>
          <FlatList
            data={messages}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={{ padding: 14 }}
            renderItem={({ item }) => {
              const mine = item.user_id === userData.id;
              const canDelete =
                userData &&
                (userData.id === item.user_id || // Message sender
                  userData.role === "teacher" || // Any teacher
                  group?.created_by === userData.id); // Group creator

              return (
                <View
                  style={[
                    styles.msgBubble,
                    mine ? styles.msgMine : styles.msgOther,
                  ]}
                >
                  <View style={styles.msgHeader}>
                    <Text style={styles.msgMeta}>{item.user_name}</Text>
                    {canDelete && (
                      <TouchableOpacity
                        onPress={() => deleteMessage(item.id)}
                        style={styles.deleteBtn}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      >
                        <Ionicons
                          name="trash-outline"
                          size={14}
                          color="#ef4444"
                        />
                      </TouchableOpacity>
                    )}
                  </View>
                  {item.text && <Text style={styles.msgText}>{item.text}</Text>}

                  {/* Display image */}
                  {item.file_url &&
                    item.file_type &&
                    item.file_type.startsWith &&
                    item.file_type.startsWith("image/") && (
                      <TouchableOpacity
                        onPress={() => Linking.openURL(item.file_url)}
                      >
                        <Image
                          source={{ uri: item.file_url }}
                          style={styles.chatImage}
                          resizeMode="cover"
                        />
                      </TouchableOpacity>
                    )}

                  {/* Display file download link */}
                  {item.file_url &&
                    (!item.file_type ||
                      !item.file_type.startsWith ||
                      !item.file_type.startsWith("image/")) && (
                      <TouchableOpacity
                        onPress={() => Linking.openURL(item.file_url)}
                        style={styles.fileLink}
                      >
                        <Ionicons
                          name="document-outline"
                          size={16}
                          color="#0ea5e9"
                        />
                        <Text style={styles.fileLinkText}>
                          {item.file_name || "Shared file"}
                        </Text>
                      </TouchableOpacity>
                    )}
                </View>
              );
            }}
          />

          <View style={styles.chatComposer}>
            {/* File preview */}
            {chatFile && (
              <View style={styles.filePreview}>
                <View style={styles.filePreviewContent}>
                  {chatFile.type && chatFile.type.startsWith("image/") ? (
                    <Image
                      source={{ uri: chatFilePreview }}
                      style={styles.filePreviewImage}
                    />
                  ) : (
                    <View style={styles.filePreviewIcon}>
                      <Ionicons
                        name="document-outline"
                        size={24}
                        color="#94a3b8"
                      />
                    </View>
                  )}
                  <View style={styles.filePreviewInfo}>
                    <Text style={styles.filePreviewName} numberOfLines={1}>
                      {chatFile.name || "Unknown file"}
                    </Text>
                    <Text style={styles.filePreviewSize}>
                      {chatFile.size
                        ? (chatFile.size / 1024 / 1024).toFixed(2)
                        : "0"}{" "}
                      MB
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={clearChatFile}
                    style={styles.clearFileBtn}
                  >
                    <Ionicons name="close-circle" size={20} color="#ef4444" />
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <View style={styles.chatInputRow}>
              <TouchableOpacity
                onPress={handleChatFileSelect}
                style={styles.attachBtn}
              >
                <Ionicons name="attach-outline" size={20} color="#94a3b8" />
              </TouchableOpacity>

              <TextInput
                style={[styles.chatInput, { flex: 1 }]}
                placeholder="Type a message"
                placeholderTextColor="#64748b"
                value={newMessage}
                onChangeText={setNewMessage}
              />

              <TouchableOpacity
                style={[
                  styles.sendBtn,
                  !newMessage.trim() && !chatFile && styles.sendBtnDisabled,
                ]}
                onPress={sendMessage}
                disabled={messageSending || (!newMessage.trim() && !chatFile)}
              >
                <Text style={styles.sendText}>
                  {messageSending ? "..." : "Send"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {activeTab === TAB_FILES && (
        <View style={styles.body}>
          <FlatList
            data={files}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={{ padding: 14 }}
            ListHeaderComponent={
              <View style={{ gap: 10 }}>
                <View style={styles.fileActions}>
                  {userData?.role === "teacher" && (
                    <TouchableOpacity
                      style={styles.primaryBtn}
                      onPress={uploadFile}
                      disabled={uploading}
                    >
                      <Text style={styles.primaryBtnText}>
                        {uploading ? "Uploading..." : "Upload File"}
                      </Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={styles.secondaryBtn}
                    onPress={fetchFiles}
                  >
                    <Text style={styles.secondaryBtnText}>Refresh</Text>
                  </TouchableOpacity>
                </View>

                <TextInput
                  style={[styles.input, { height: 140 }, { color: "#fff" }]}
                  placeholder="Paste notes here or use a file from Files tab"
                  placeholderTextColor="#64748b"
                  value={aiContent}
                  onChangeText={setAiContent}
                  multiline
                />

                <View
                  style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}
                >
                  <TouchableOpacity
                    style={styles.primaryBtn}
                    onPress={handleAISummary}
                    disabled={aiLoading}
                  >
                    <Text style={styles.primaryBtnText}>Summary</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.primaryBtn}
                    onPress={handleAIFlashcards}
                    disabled={aiLoading}
                  >
                    <Text style={styles.primaryBtnText}>Flashcards</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.primaryBtn}
                    onPress={handleAIQuiz}
                    disabled={aiLoading}
                  >
                    <Text style={styles.primaryBtnText}>Quiz</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.secondaryBtn,
                      { backgroundColor: "#ef4444" },
                    ]}
                    onPress={clearAIContent}
                    disabled={aiLoading}
                  >
                    <Text style={styles.secondaryBtnText}>Clear</Text>
                  </TouchableOpacity>
                </View>

                {aiLoading ? (
                  <ActivityIndicator
                    color="#0ea5e9"
                    style={{ marginVertical: 20 }}
                  />
                ) : null}

                {aiResult ? (
                  <View style={styles.aiCard}>
                    <Text style={styles.aiTitle}>
                      {aiResult.type.toUpperCase()}
                    </Text>
                    {aiResult.type === "summary" && (
                      <Text style={styles.aiText}>{aiResult.content}</Text>
                    )}
                    {aiResult.type === "flashcards" && (
                      <View style={{ gap: 12 }}>
                        {Array.isArray(aiResult.content) &&
                        aiResult.content.length > 0 ? (
                          aiResult.content.map((card, idx) => (
                            <View key={idx} style={styles.innerCard}>
                              <Text style={styles.qText}>
                                Q: {card.question || "No question available"}
                              </Text>
                              <View style={styles.divider} />
                              <Text style={styles.aText}>
                                A: {card.answer || "No answer available"}
                              </Text>
                            </View>
                          ))
                        ) : (
                          <Text style={styles.aiText}>
                            No flashcards available. Please try again.
                          </Text>
                        )}
                      </View>
                    )}
                    {aiResult.type === "quiz" && (
                      <View style={{ gap: 12 }}>
                        {Array.isArray(aiResult.content) &&
                        aiResult.content.length > 0 ? (
                          <>
                            {aiResult.content.map((q, idx) => (
                              <View key={idx} style={styles.innerCard}>
                                <Text style={styles.qText}>
                                  {idx + 1}.{" "}
                                  {q.question || "No question available"}
                                </Text>
                                {Array.isArray(q.options) &&
                                q.options.length === 4 ? (
                                  q.options.map((opt, i) => {
                                    const isSelected =
                                      quizSelections[idx] === i;
                                    const isRevealed = quizRevealed[idx];
                                    const isCorrect = i === q.correctAnswer;
                                    const isIncorrect =
                                      isSelected && !isCorrect && isRevealed;

                                    // Determine Styles
                                    let optionStyle = [styles.quizOption];
                                    let radioStyle = [styles.quizRadio];
                                    let radioTextStyle = [styles.quizRadioText];

                                    if (quizSubmitted) {
                                      if (isCorrect) {
                                        optionStyle.push(
                                          styles.quizOptionCorrect,
                                        );
                                        radioStyle.push(
                                          styles.quizRadioCorrect,
                                        );
                                        radioTextStyle.push(
                                          styles.quizRadioTextActive,
                                        );
                                      } else if (isIncorrect) {
                                        optionStyle.push(
                                          styles.quizOptionIncorrect,
                                        );
                                        radioStyle.push(
                                          styles.quizRadioIncorrect,
                                        );
                                        radioTextStyle.push(
                                          styles.quizRadioTextActive,
                                        );
                                      } else if (isSelected) {
                                        // Selected but not the specifically correct/incorrect one marked above?
                                        // Wait, isIncorrect covers it. If just selected and not incorrect (impossible if submitted),
                                        // or if correct answer was selected (covered by isCorrect).
                                        // So this case might be redundant for submitted, but safe to keep.
                                        optionStyle.push(
                                          styles.quizOptionSelected,
                                        );
                                        radioStyle.push(
                                          styles.quizRadioSelected,
                                        );
                                        radioTextStyle.push(
                                          styles.quizRadioTextActive,
                                        );
                                      }
                                    } else if (isSelected) {
                                      optionStyle.push(
                                        styles.quizOptionSelected,
                                      );
                                      radioStyle.push(styles.quizRadioSelected);
                                      radioTextStyle.push(
                                        styles.quizRadioTextActive,
                                      );
                                    }

                                    return (
                                      <TouchableOpacity
                                        key={i}
                                        onPress={() =>
                                          !quizSubmitted &&
                                          handleQuizOptionClick(idx, i)
                                        }
                                        style={optionStyle}
                                        disabled={quizSubmitted}
                                        activeOpacity={0.7}
                                      >
                                        {/* Radio Circle with Letter */}
                                        <View style={radioStyle}>
                                          <Text style={radioTextStyle}>
                                            {String.fromCharCode(65 + i)}
                                          </Text>
                                        </View>

                                        {/* Option Text */}
                                        <Text style={styles.quizContentText}>
                                          {opt || "No option text"}
                                        </Text>

                                        {/* Status Indicators */}
                                        {isSelected && !quizSubmitted && (
                                          <View style={{ marginLeft: 8 }}>
                                            <Ionicons
                                              name="checkmark-circle"
                                              size={24}
                                              color="#3b82f6"
                                            />
                                          </View>
                                        )}
                                        {quizSubmitted && isCorrect && (
                                          <View style={{ marginLeft: 8 }}>
                                            <Ionicons
                                              name="checkmark-circle"
                                              size={24}
                                              color="#10b981"
                                            />
                                          </View>
                                        )}
                                        {quizSubmitted && isIncorrect && (
                                          <View style={{ marginLeft: 8 }}>
                                            <Ionicons
                                              name="close-circle"
                                              size={24}
                                              color="#ef4444"
                                            />
                                          </View>
                                        )}
                                      </TouchableOpacity>
                                    );
                                  })
                                ) : (
                                  <Text style={styles.aiText}>
                                    Invalid options format
                                  </Text>
                                )}
                              </View>
                            ))}

                            {/* Submit Button and Results */}
                            <View
                              style={{
                                marginTop: 16,
                                paddingTop: 16,
                                borderTopWidth: 1,
                                borderTopColor: "#333",
                              }}
                            >
                              {!quizSubmitted ? (
                                <TouchableOpacity
                                  onPress={handleSubmitQuiz}
                                  disabled={
                                    Object.keys(quizSelections).length !==
                                    aiResult.content.length
                                  }
                                  style={[
                                    styles.primaryBtn,
                                    Object.keys(quizSelections).length !==
                                      aiResult.content.length &&
                                      styles.disabledBtn,
                                  ]}
                                >
                                  <Text style={styles.primaryBtnText}>
                                    Submit Quiz (
                                    {Object.keys(quizSelections).length}/
                                    {aiResult.content.length} answered)
                                  </Text>
                                </TouchableOpacity>
                              ) : (
                                <View style={{ gap: 12 }}>
                                  <View style={styles.scoreCard}>
                                    <Text style={styles.scoreTitle}>
                                      Quiz Results
                                    </Text>
                                    <Text style={styles.scoreText}>
                                      You scored {calculateQuizScore()} out of{" "}
                                      {aiResult.content.length} questions
                                      correctly!
                                    </Text>
                                  </View>
                                  <TouchableOpacity
                                    onPress={resetQuiz}
                                    style={styles.resetQuizBtn}
                                  >
                                    <Text style={styles.secondaryBtnText}>
                                      Reset Quiz
                                    </Text>
                                  </TouchableOpacity>
                                </View>
                              )}
                            </View>
                          </>
                        ) : (
                          <Text style={styles.aiText}>
                            No quiz questions available. Please try again.
                          </Text>
                        )}
                      </View>
                    )}
                  </View>
                ) : null}
              </View>
            }
            ListEmptyComponent={
              <Text style={styles.emptyText}>No files yet.</Text>
            }
            renderItem={({ item }) => (
              <View style={styles.fileCard}>
                <Text style={styles.fileName}>{item.name}</Text>
                <Text style={styles.fileMeta}>
                  by {item.uploadedByName || "Unknown"}
                </Text>
                <View style={styles.fileRow}>
                  <TouchableOpacity
                    style={[styles.chipBtn, styles.chipOpen]}
                    onPress={() =>
                      item.url
                        ? Linking.openURL(item.url)
                        : showAlert("File", "No URL")
                    }
                  >
                    <Text style={styles.chipText}>Open</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.chipBtn, styles.chipDownload]}
                    onPress={() => handleDownloadFile(item)}
                  >
                    <Text style={styles.chipText}>Download</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.chipBtn, styles.chipAi]}
                    onPress={() => loadFileForAI(item)}
                  >
                    <Text style={styles.chipText}>Use for AI</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          />
        </View>
      )}

      {activeTab === TAB_SESSIONS && (
        <View style={styles.body}>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 16 }}
            showsVerticalScrollIndicator={true}
          >
            {/* CREATE SESSION (ONLY GROUP CREATOR / TEACHER) */}
            {group?.created_by === userData?.id && (
              <View style={styles.createBox}>
                <Text style={styles.heading}>Create Study Session</Text>

                {/* SESSION TITLE */}
                <Text style={styles.label}>Session Title</Text>
                <TextInput
                  value={sessionTitle}
                  onChangeText={setSessionTitle}
                  style={[styles.input, { color: "#fff" }]}
                  placeholder="Algebra Revision"
                  placeholderTextColor="#64748b"
                />

                {/* DESCRIPTION */}
                <Text style={styles.label}>Description</Text>
                <TextInput
                  value={sessionDescription}
                  onChangeText={setSessionDescription}
                  style={[styles.input, { height: 80 }, { color: "#fff" }]}
                  multiline
                  placeholder="Session description"
                  placeholderTextColor="#64748b"
                />

                {/* START TIME */}
                <Text style={styles.label}>Start Time</Text>
                <TouchableOpacity
                  style={styles.dateBtn}
                  onPress={() => {
                    try {
                      setTempDate(new Date(sessionStartTime));
                      setPickerMode("date");
                      setShowPicker(true);
                    } catch (error) {
                      console.error("Error showing date picker:", error);
                      showAlert("Error", "Could not open date picker");
                    }
                  }}
                >
                  <Text style={styles.dateBtnText}>
                    {sessionStartTime.toLocaleDateString()} at{" "}
                    {sessionStartTime.toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </Text>
                </TouchableOpacity>

                {/* DATE TIME PICKER */}
                {showPicker && (
                  <DateTimePicker
                    value={tempDate}
                    mode={pickerMode}
                    display="default"
                    onChange={(event, selectedDate) => {
                      if (Platform.OS === "android") {
                        if (event.type === "set" && selectedDate) {
                          if (pickerMode === "date") {
                            // Switch to time picker after date is selected
                            setTempDate(selectedDate);
                            setPickerMode("time");
                          } else {
                            // Final selection - update session start time
                            setSessionStartTime(selectedDate);
                            setShowPicker(false);
                            setPickerMode("date");
                          }
                        } else if (event.type === "dismissed") {
                          // User cancelled
                          setShowPicker(false);
                          setPickerMode("date");
                        }
                      } else {
                        // iOS - handle both date and time in one go
                        if (selectedDate) {
                          setSessionStartTime(selectedDate);
                        }
                        setShowPicker(false);
                        setPickerMode("date");
                      }
                    }}
                    minimumDate={new Date()}
                  />
                )}

                {/* CREATE SESSION BUTTON */}
                <TouchableOpacity
                  style={[styles.primaryBtn, { marginTop: 16 }]}
                  onPress={createSession}
                  disabled={sessionLoading}
                >
                  <Text style={styles.primaryBtnText}>
                    {sessionLoading ? "Creating..." : "Create Session"}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* UPCOMING SESSIONS */}
            <Text style={styles.heading}>Upcoming Sessions</Text>

            {sessions.length === 0 && (
              <Text style={styles.empty}>No sessions scheduled yet.</Text>
            )}

            {sessions.map((session) => (
              <View key={session.id} style={styles.sessionCard}>
                <Text style={styles.sessionTitle}>{session.title}</Text>

                {session.description && (
                  <Text style={styles.sessionDesc}>{session.description}</Text>
                )}

                <Text style={styles.sessionMeta}>
                  Starts:{" "}
                  {session.start_time
                    ? new Date(session.start_time).toLocaleString()
                    : "Not set"}
                </Text>

                <Text style={styles.sessionMeta}>
                  Host: {session.created_by_name}
                </Text>

                {/* ACTION BUTTONS */}
                <View style={styles.sessionActionsRow}>
                  {recording && recordingSessionId === session.id ? (
                    <TouchableOpacity
                      style={styles.redBtn} // Use red for stop action
                      onPress={stopRecording}
                      disabled={isProcessingRecording}
                    >
                      <Text style={styles.btnText}>
                        {isProcessingRecording
                          ? "Processing..."
                          : "Stop Recording & Summarize"}
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <>
                      <TouchableOpacity
                        style={styles.greenBtn}
                        onPress={() => handleJoinSession(session)}
                      >
                        <Text style={styles.btnText}>Join Live</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.grayBtn}
                        onPress={async () => {
                          await Clipboard.setStringAsync(
                            getJitsiPublicUrl(session),
                          );
                          showAlert("Copied", "Meeting link copied");
                        }}
                      >
                        <Text style={styles.btnText}>Copy Link</Text>
                      </TouchableOpacity>
                    </>
                  )}

                  {(group?.created_by === userData?.id ||
                    userData?.role === "teacher") && (
                    <TouchableOpacity
                      style={[
                        styles.grayBtn,
                        { backgroundColor: "#4f46e5", borderColor: "#4f46e5" },
                      ]}
                      onPress={() => viewAttendance(session)}
                    >
                      <Text style={styles.btnText}>Attendance</Text>
                    </TouchableOpacity>
                  )}

                  {group?.created_by === userData?.id && (
                    <TouchableOpacity
                      style={styles.redBtn}
                      onPress={() => deleteLiveMeeting(session)}
                    >
                      <Text style={styles.btnText}>Delete</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* RECORDING */}
                {session.recording_path && (
                  <View style={styles.recordingBox}>
                    <Text style={styles.subHeading}>Recording</Text>

                    <TouchableOpacity
                      style={styles.grayBtn}
                      onPress={() => {
                        if (recordingUrls[session.id]) {
                          Linking.openURL(recordingUrls[session.id]);
                        } else {
                          loadRecordingUrl(session);
                          showAlert("Loading", "Loading recording URL...");
                        }
                      }}
                    >
                      <Text style={styles.btnText}>
                        {recordingUrls[session.id]
                          ? "Play Recording"
                          : "Load Recording"}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.purpleBtn}
                      disabled={summaryLoading[session.id]}
                      onPress={() => generateSummaryFromRecording(session)}
                    >
                      <Text style={styles.btnText}>
                        {summaryLoading[session.id]
                          ? "Generating..."
                          : session.ai_summary
                            ? "Regenerate Summary"
                            : "Generate AI Summary"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* AI SUMMARY */}
                {session.ai_summary && (
                  <View style={styles.summaryBox}>
                    <Text style={styles.subHeading}>AI Summary</Text>
                    <Text style={styles.summaryText}>{session.ai_summary}</Text>
                  </View>
                )}

                {/* TRANSCRIPT */}
                {session.transcript && (
                  <View style={styles.transcriptBox}>
                    <Text style={styles.subHeading}>Transcript</Text>
                    <View style={styles.innerCard}>
                      <Text style={styles.transcriptText} numberOfLines={8}>
                        {session.transcript}
                      </Text>
                    </View>
                  </View>
                )}
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {activeTab === TAB_AI && (
        <View style={styles.body}>
          <View style={{ padding: 14, flex: 1 }}>
            <View style={styles.aiCardExpanded}>
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 12,
                }}
              >
                <Text style={[styles.aiTitle, { marginBottom: 0 }]}>
                  AI Tutor
                </Text>
                <TouchableOpacity
                  onPress={() => setTutorMessages([])}
                  style={{
                    backgroundColor: "#EF4444",
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                    borderRadius: 6,
                  }}
                >
                  <Text
                    style={{ color: "white", fontWeight: "600", fontSize: 12 }}
                  >
                    Clear Chat
                  </Text>
                </TouchableOpacity>
              </View>
              <FlatList
                data={tutorMessages}
                keyExtractor={(_, idx) => String(idx)}
                style={styles.tutorChatList}
                contentContainerStyle={styles.tutorChatContainer}
                renderItem={({ item }) => (
                  <View style={styles.tutorMessageBubble}>
                    <Text style={styles.tutorMessageRole}>{item.role}</Text>
                    <Text style={styles.tutorMessageContent}>
                      {item.content}
                    </Text>
                  </View>
                )}
              />
              <View style={styles.tutorInputContainer}>
                <TextInput
                  style={[
                    styles.input,
                    styles.tutorInput,
                    { color: "#ffffff" },
                  ]}
                  placeholder="Ask a question"
                  placeholderTextColor="#64748b"
                  value={tutorInput}
                  onChangeText={setTutorInput}
                  multiline
                />
                <TouchableOpacity
                  style={styles.sendBtn}
                  onPress={tutorSend}
                  disabled={tutorLoading}
                >
                  <Text style={styles.sendText}>
                    {tutorLoading ? "..." : "Ask"}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* Session Password Confirmation Modal */}
      <Modal
        visible={showSessionPasswordModal}
        transparent
        animationType="fade"
      >
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Confirm Password</Text>
            <Text style={styles.modalSubtitle}>
              As a teacher, you must enter your password to delete this session.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your password"
              value={sessionDeletePassword}
              onChangeText={setSessionDeletePassword}
              secureTextEntry
            />
            {sessionDeleteError && (
              <Text style={styles.errorText}>{sessionDeleteError}</Text>
            )}
            <View style={styles.modalRow}>
              <TouchableOpacity
                style={styles.modalPrimary}
                onPress={handleSessionPasswordConfirm}
              >
                <Text style={styles.btnText}>Confirm</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalGhost}
                onPress={handleSessionPasswordCancel}
              >
                <Text>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Join Live Modal */}
      <Modal visible={showJoinModal} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Join Session</Text>
            <Text style={styles.modalSubtitle}>
              Please enter your details to join.
            </Text>

            <TextInput
              style={[styles.input, { color: "#000" }]}
              placeholder="Full Name"
              placeholderTextColor="#666"
              value={joinName}
              onChangeText={setJoinName}
            />

            <TextInput
              style={[styles.input, { color: "#000" }]}
              placeholder="Roll Number"
              placeholderTextColor="#666"
              value={joinRoleNo}
              onChangeText={setJoinRoleNo}
            />

            <View style={styles.modalRow}>
              <TouchableOpacity
                style={styles.modalPrimary}
                onPress={submitJoinDetails}
              >
                <Text style={styles.btnText}>Join</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalGhost}
                onPress={() => setShowJoinModal(false)}
              >
                <Text
                  style={{
                    textAlign: "center",
                    fontWeight: "bold",
                    color: "#000",
                  }}
                >
                  Cancel
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Attendance Modal */}
      <Modal visible={showAttendanceModal} transparent animationType="slide">
        <View style={styles.modalBg}>
          <View style={[styles.modalCard, { maxHeight: "80%" }]}>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 10,
              }}
            >
              <Text style={styles.modalTitle}>Attendance</Text>
              <TouchableOpacity onPress={() => setShowAttendanceModal(false)}>
                <Ionicons name="close" size={24} color="#000" />
              </TouchableOpacity>
            </View>

            {loadingAttendance ? (
              <ActivityIndicator size="large" color="#0ea5e9" />
            ) : attendanceList.length === 0 ? (
              <Text style={{ color: "#666", textAlign: "center", padding: 20 }}>
                No attendance records found.
              </Text>
            ) : (
              <FlatList
                data={attendanceList}
                keyExtractor={(item) => item.id.toString()}
                renderItem={({ item }) => (
                  <View
                    style={{
                      borderBottomWidth: 1,
                      borderBottomColor: "#eee",
                      paddingVertical: 10,
                    }}
                  >
                    <Text
                      style={{
                        fontWeight: "bold",
                        fontSize: 16,
                        color: "#000",
                      }}
                    >
                      {item.student_name}
                    </Text>
                    <Text style={{ color: "#666" }}>
                      Roll No: {item.role_number}
                    </Text>
                    <Text style={{ color: "#999", fontSize: 12 }}>
                      Joined: {new Date(item.joined_at).toLocaleTimeString()}
                    </Text>
                  </View>
                )}
              />
            )}
          </View>
        </View>
      </Modal>

      <HeadlessFileParser ref={parserRef} />
    </SafeAreaView>
  );
};

const Tab = ({ label, active, onPress }) => {
  return (
    <TouchableOpacity
      style={[styles.tab, active && styles.tabActive]}
      onPress={onPress}
    >
      <Text style={[styles.tabText, active && styles.tabTextActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b1220" },
  topBar: {
    marginVertical: 30,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(148,163,184,0.18)",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  backBtn: {
    backgroundColor: "rgba(148,163,184,0.16)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  backText: { color: "#e2e8f0", fontWeight: "800" },
  groupTitle: { color: "#f8fafc", fontSize: 18, fontWeight: "900" },
  groupSub: { color: "#94a3b8", fontSize: 12, marginTop: 2 },
  groupIdCard: {
    marginHorizontal: 14,
    marginTop: 10,
    padding: 12,
    borderRadius: 16,
    backgroundColor: "rgba(15,23,42,0.85)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.18)",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  groupIdLabel: { color: "#94a3b8", fontSize: 12, marginBottom: 4 },
  groupIdValue: { color: "#e2e8f0", fontWeight: "900" },
  copyChip: {
    backgroundColor: "rgba(148,163,184,0.16)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.18)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  copyChipText: { color: "#e2e8f0", fontWeight: "900" },
  tabs: {
    flexDirection: "row",
    paddingHorizontal: 10,
    paddingTop: 10,
    gap: 8,
    flexWrap: "wrap",
  },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.18)",
    backgroundColor: "rgba(15,23,42,0.65)",
  },
  tabActive: { backgroundColor: "#0ea5e9", borderColor: "#0ea5e9" },
  tabText: { color: "#cbd5e1", fontWeight: "800" },
  tabTextActive: { color: "#fff" },
  body: { flex: 1 },
  msgBubble: {
    padding: 10,
    borderRadius: 14,
    marginBottom: 10,
    borderWidth: 1,
  },
  msgHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  msgMine: {
    backgroundColor: "rgba(14,165,233,0.15)",
    borderColor: "rgba(14,165,233,0.45)",
  },
  msgOther: {
    backgroundColor: "rgba(148,163,184,0.12)",
    borderColor: "rgba(148,163,184,0.18)",
  },
  msgMeta: { color: "#94a3b8", fontSize: 12, flex: 1 },
  msgText: { color: "#e2e8f0" },
  deleteBtn: {
    padding: 4,
    borderRadius: 4,
    opacity: 0.7,
  },
  chatComposer: {
    flexDirection: "column",
    gap: 10,
    padding: 24,
    borderTopWidth: 1,
    borderTopColor: "rgba(148,163,184,0.18)",
  },
  chatInputRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
  },
  attachBtn: {
    padding: 12,
    backgroundColor: "rgba(14,165,233,0.1)",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(14,165,233,0.3)",
  },
  filePreview: {
    marginBottom: 10,
  },
  filePreviewContent: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(30,41,59,0.5)",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.2)",
  },
  filePreviewImage: {
    width: 40,
    height: 40,
    borderRadius: 8,
    resizeMode: "cover",
  },
  filePreviewIcon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: "rgba(148,163,184,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },
  filePreviewInfo: {
    flex: 1,
    marginLeft: 12,
  },
  filePreviewName: {
    color: "#e2e8f0",
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 2,
  },
  filePreviewSize: {
    color: "#94a3b8",
    fontSize: 12,
  },
  clearFileBtn: {
    padding: 4,
  },
  chatImage: {
    width: 200,
    height: 150,
    borderRadius: 8,
    marginTop: 8,
  },
  fileLink: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(14,165,233,0.1)",
    borderRadius: 8,
    padding: 8,
    marginTop: 8,
    borderWidth: 1,
    borderColor: "rgba(14,165,233,0.3)",
  },
  fileLinkText: {
    color: "#0ea5e9",
    fontSize: 13,
    fontWeight: "600",
    marginLeft: 8,
  },
  sendBtn: {
    backgroundColor: "#0ea5e9",
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 60,
    shadowColor: "#0ea5e9",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  sendBtnDisabled: {
    backgroundColor: "#475569",
    opacity: 0.5,
    shadowColor: "transparent",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  sendText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
  },
  fileActions: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 14,
  },
  primaryBtn: {
    backgroundColor: "#0ea5e9",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
  },
  primaryBtnText: { color: "#fff", fontWeight: "900" },
  secondaryBtn: {
    backgroundColor: "rgba(148,163,184,0.16)",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
  },
  secondaryBtnText: { color: "#e2e8f0", fontWeight: "900" },
  fileCard: {
    backgroundColor: "rgba(15,23,42,0.85)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.18)",
    borderRadius: 16,
    padding: 12,
    marginBottom: 10,
    marginTop: 10,
  },
  fileName: { color: "#f8fafc", fontWeight: "900" },
  fileMeta: { color: "#94a3b8", fontSize: 12, marginTop: 6 },
  fileRow: { flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" },
  chipBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
  chipOpen: { backgroundColor: "#0ea5e9" },
  chipDownload: { backgroundColor: "#f97316" }, // Orange for download
  chipAi: { backgroundColor: "#8b5cf6" },
  chipDel: { backgroundColor: "#b91c1c" },
  chipDisabled: { backgroundColor: "#64748b" },
  chipText: { color: "#fff", fontWeight: "900" },
  emptyText: { color: "#94a3b8", padding: 14 },
  input: {
    backgroundColor: "rgba(15,23,42,0.85)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.18)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#e2e8f0",
  },
  chatInput: {
    backgroundColor: "rgba(15,23,42,0.85)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.18)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: "#e2e8f0",
    fontSize: 16,
    minHeight: 44,
  },
  sessionCard: {
    backgroundColor: "rgba(15,23,42,0.85)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.18)",
    borderRadius: 16,
    padding: 12,
    marginBottom: 10,
  },
  sessionTitle: { color: "#f8fafc", fontWeight: "900" },
  sessionDesc: { color: "#cbd5e1", marginTop: 6 },
  sessionMeta: { color: "#94a3b8", fontSize: 12, marginTop: 8 },
  sessionActionsRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
    flexWrap: "wrap",
  },
  aiCard: {
    marginTop: 12,
    padding: 12,
    borderRadius: 16,
    backgroundColor: "rgba(15,23,42,0.85)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.18)",
  },
  aiCardExpanded: {
    flex: 1,
    padding: 16,
    borderRadius: 16,
    backgroundColor: "rgba(15,23,42,0.85)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.18)",
  },
  aiTitle: {
    color: "#f8fafc",
    fontWeight: "900",
    marginBottom: 12,
    fontSize: 18,
  },
  aiText: { color: "#e2e8f0" },
  tutorChatList: {
    flex: 1,
    marginBottom: 16,
  },
  tutorChatContainer: {
    paddingBottom: 8,
  },
  tutorMessageBubble: {
    marginBottom: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "rgba(30,41,59,0.6)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.15)",
  },
  tutorMessageRole: {
    color: "#94a3b8",
    fontSize: 11,
    marginBottom: 4,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  tutorMessageContent: {
    color: "#e2e8f0",
    fontSize: 14,
    lineHeight: 20,
  },
  tutorInputContainer: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-end",
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(148,163,184,0.18)",
  },
  tutorInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 100,
    textAlignVertical: "top",
  },

  // New Sessions tab styles
  card: { padding: 16 },
  createBox: {
    backgroundColor: "rgba(15,23,42,0.85)",
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.18)",
  },
  heading: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 10,
    color: "#f8fafc",
  },
  label: { fontSize: 14, marginTop: 8, color: "#cbd5e1" },
  dateBtn: {
    padding: 10,
    borderWidth: 1,
    borderRadius: 8,
    marginTop: 4,
    backgroundColor: "rgba(15,23,42,0.85)",
    borderColor: "rgba(148,163,184,0.18)",
  },
  dateBtnText: { color: "#e2e8f0" },
  btnText: { color: "#fff", fontWeight: "600" },
  desc: { color: "#555", marginTop: 4 },
  meta: { fontSize: 12, color: "#777", marginTop: 4 },
  errorText: { color: "#f87171", fontSize: 12, marginTop: 8 },
  row: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
    flexWrap: "wrap",
  },
  greenBtn: {
    backgroundColor: "#059669",
    padding: 10,
    borderRadius: 8,
  },
  redBtn: {
    backgroundColor: "#dc2626",
    padding: 10,
    borderRadius: 8,
  },
  purpleBtn: {
    backgroundColor: "#7c3aed",
    padding: 10,
    borderRadius: 8,
    marginTop: 10,
  },
  grayBtn: {
    backgroundColor: "rgba(148,163,184,0.16)",
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.18)",
  },
  recordingBox: { marginTop: 12 },
  summaryBox: {
    marginTop: 12,
    backgroundColor: "rgba(15,23,42,0.85)",
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.18)",
  },
  summaryText: { fontSize: 13, color: "#e2e8f0", lineHeight: 20 },
  transcriptBox: { marginTop: 12 },
  transcriptText: { fontSize: 13, color: "#cbd5e1", lineHeight: 18 },
  subHeading: {
    fontWeight: "800",
    marginBottom: 8,
    color: "#f8fafc",
    fontSize: 14,
  },
  empty: { textAlign: "center", color: "#94a3b8", marginTop: 40, fontSize: 14 },
  pickerContainer: {
    backgroundColor: "rgba(15,23,42,0.85)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.18)",
    borderRadius: 12,
    padding: 10,
    marginTop: 8,
  },
  pickerButtonsContainer: {
    flexDirection: "row",
    gap: 5,
    marginTop: 10,
  },

  // AI Result Styles
  innerCard: {
    backgroundColor: "rgba(2,6,23,0.5)",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.1)",
    marginBottom: 8,
  },
  qText: { color: "#f8fafc", fontWeight: "700", fontSize: 14, marginBottom: 8 },
  aText: { color: "#38bdf8", fontWeight: "600", fontSize: 14 },
  divider: {
    height: 1,
    backgroundColor: "rgba(148,163,184,0.1)",
    marginVertical: 8,
  },
  optText: { color: "#94a3b8", fontSize: 13, marginTop: 4, paddingLeft: 4 },
  correctOpt: { color: "#10b981", fontWeight: "700" },

  // Interactive Quiz Styles
  // Interactive Quiz Styles
  quizOption: {
    backgroundColor: "rgba(30,41,59,0.5)",
    padding: 12,
    borderRadius: 12,
    marginTop: 8,
    borderWidth: 2,
    borderColor: "rgba(148,163,184,0.2)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    minHeight: 60,
  },
  quizOptionSelected: {
    backgroundColor: "rgba(59,130,246,0.15)",
    borderColor: "#3b82f6",
  },
  quizOptionCorrect: {
    backgroundColor: "rgba(16,185,129,0.15)",
    borderColor: "#10b981",
  },
  quizOptionIncorrect: {
    backgroundColor: "rgba(239,68,68,0.15)",
    borderColor: "#ef4444",
  },
  // Radio Circle Styles
  quizRadio: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: "#64748b",
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  quizRadioSelected: {
    backgroundColor: "#3b82f6",
    borderColor: "#3b82f6",
  },
  quizRadioCorrect: {
    backgroundColor: "#10b981",
    borderColor: "#10b981",
  },
  quizRadioIncorrect: {
    backgroundColor: "#ef4444",
    borderColor: "#ef4444",
  },
  quizRadioText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#94a3b8",
  },
  quizRadioTextActive: {
    color: "#ffffff",
  },
  // Option Text Styles
  quizContentText: {
    flex: 1,
    color: "#e2e8f0",
    fontSize: 15,
    fontWeight: "500",
    lineHeight: 22,
  },
  resetQuizBtn: {
    backgroundColor: "#7c3aed",
    padding: 10,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 16,
  },
  disabledBtn: {
    backgroundColor: "#475569",
    opacity: 0.6,
  },
  scoreCard: {
    backgroundColor: "rgba(14,165,233,0.1)",
    borderWidth: 1,
    borderColor: "rgba(14,165,233,0.3)",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
  },
  scoreTitle: {
    color: "#0ea5e9",
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 8,
  },
  scoreText: {
    color: "#e2e8f0",
    fontSize: 14,
    textAlign: "center",
  },
  // Modal styles for password confirmation
  modalBg: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: { backgroundColor: "#fff", borderRadius: 14, padding: 16 },
  modalTitle: { fontSize: 18, fontWeight: "800", marginBottom: 10 },
  modalSubtitle: { fontSize: 14, color: "#6b7280", marginBottom: 16 },
  modalRow: { flexDirection: "row", gap: 10, marginTop: 10 },
  modalPrimary: {
    flex: 1,
    backgroundColor: "#0ea5e9",
    padding: 12,
    borderRadius: 10,
  },
  modalGhost: {
    flex: 1,
    backgroundColor: "#e5e7eb",
    padding: 12,
    borderRadius: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  errorText: { color: "#ef4444", fontSize: 12, marginTop: 4 },
  btnText: { color: "#fff", textAlign: "center", fontWeight: "800" },
});

export default StudyGroup;
