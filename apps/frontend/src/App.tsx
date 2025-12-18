import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Container,
  Divider,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Link,
  MenuItem,
  Paper,
  Select,
  Tooltip,
  LinearProgress,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import EditIcon from "@mui/icons-material/Edit";
import FlagIcon from "@mui/icons-material/Flag";
import SearchIcon from "@mui/icons-material/Search";
import { TodoResponseSchema, TodosListResponseSchema } from "@arkivia/shared";
import {
  closestCenter,
  DndContext,
  type DragEndEvent
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { alpha } from "@mui/material/styles";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useAuth } from "./auth";

type Todo = {
  id: string;
  title: string;
  description?: string | null;
  status: "active" | "done";
  createdByUid: string;
  ownerUid: string;
  assigneeUids: string[];
  position: number;
  priority: "low" | "medium" | "high";
  createdAt: string;
  updatedAt: string;
};

type UserSummary = {
  uid: string;
  email: string | null;
  displayName: string | null;
};

type TodosState =
  | { status: "idle"; todos: Todo[] }
  | { status: "loading"; todos: Todo[] }
  | { status: "ok"; todos: Todo[] }
  | { status: "error"; todos: Todo[]; message: string };

export default function App() {
  const [todosState, setTodosState] = useState<TodosState>({ status: "idle", todos: [] });
  const [reloadTick, setReloadTick] = useState(0);
  const [assigningTodoId, setAssigningTodoId] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const sseBaseUrl = (import.meta.env.VITE_SSE_BASE_URL as string | undefined) ?? null;
  const [userQuery, setUserQuery] = useState("");
  const [userResults, setUserResults] = useState<UserSummary[]>([]);
  const [userSearchStatus, setUserSearchStatus] = useState<"idle" | "loading" | "error" | "ok">("idle");
  const [userCache, setUserCache] = useState<Record<string, UserSummary>>({});
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [taskDialogMode, setTaskDialogMode] = useState<"create" | "view" | "edit">("create");
  const [editingTodoId, setEditingTodoId] = useState<string | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formPriority, setFormPriority] = useState<Todo["priority"]>("medium");
  const [formAssigneeUids, setFormAssigneeUids] = useState<string[]>([]);
  const [formUserQuery, setFormUserQuery] = useState("");
  const [formUserResults, setFormUserResults] = useState<UserSummary[]>([]);
  const [formUserSearchStatus, setFormUserSearchStatus] = useState<"idle" | "loading" | "error" | "ok">(
    "idle"
  );
  const { state: authState, signInWithGoogle, signOut } = useAuth();

  const realtimeTodoIdsKey = useMemo(() => {
    const ids = todosState.todos.map((t) => t.id).sort();
    return ids.join(",");
  }, [todosState.todos]);

  const deniedRealtimeDocIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (authState.status !== "signed_in") return;
    if (!sseBaseUrl && !sessionReady) return;

    const user = authState.user;
    if (!user) return;

    let closed = false;
    let es: EventSource | null = null;
    let timeout: number | undefined;
    const debounceMs = 250;

    function scheduleRefresh() {
      if (timeout !== undefined) {
        window.clearTimeout(timeout);
      }
      timeout = window.setTimeout(() => {
        setReloadTick((t) => t + 1);
      }, debounceMs);
    }

    async function connect() {
      const streamUrl = sseBaseUrl
        ? `${sseBaseUrl.replace(/\/$/, "")}/api/todos/stream?token=${encodeURIComponent(await user.getIdToken())}`
        : "/api/todos/stream";

      es = new EventSource(streamUrl);

      es.addEventListener("todos_changed", scheduleRefresh);
      es.addEventListener("ready", scheduleRefresh);
      es.onerror = () => {
        if (closed) return;
        try {
          es?.close();
        } catch {
          // ignore
        }
        es = null;
        window.setTimeout(() => {
          if (!closed) void connect();
        }, 2000);
      };
    }

    void connect();

    return () => {
      closed = true;
      if (timeout !== undefined) window.clearTimeout(timeout);
      try {
        es?.close();
      } catch {
        // ignore
      }
    };
  }, [authState, sessionReady, sseBaseUrl]);

  useEffect(() => {
    if (authState.status !== "signed_out") return;
    setSessionReady(false);
    void fetch("/api/session", { method: "DELETE" });
  }, [authState]);

  useEffect(() => {
    async function syncMe() {
      if (authState.status !== "signed_in") return;

      try {
        const token = await authState.user.getIdToken();
        await fetch("/api/session", {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`
          }
        });
        setSessionReady(true);
        await fetch("/api/users/me", {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`
          }
        });
      } catch {
        // Best-effort; ignore
      }
    }

    void syncMe();
  }, [authState]);

  useEffect(() => {
    let cancelled = false;

    async function loadTodos() {
      if (authState.status !== "signed_in") {
        setTodosState({ status: "idle", todos: [] });
        return;
      }

      setTodosState((prev) => ({ status: "loading", todos: prev.todos }));
      try {
        const token = await authState.user.getIdToken();
        const res = await fetch("/api/todos", {
          headers: {
            authorization: `Bearer ${token}`
          }
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || `HTTP ${res.status}`);
        }

        const raw = await res.json();
        const parsed = TodosListResponseSchema.safeParse(raw);
        if (!parsed.success) {
          throw new Error("Invalid /api/todos response shape");
        }

        const json = parsed.data as unknown as { todos: Todo[] };
        if (!cancelled) {
          setTodosState({ status: "ok", todos: json.todos });
        }
      } catch (err) {
        if (!cancelled) {
          setTodosState({ status: "error", todos: [], message: err instanceof Error ? err.message : "Unknown error" });
        }
      }
    }

    void loadTodos();

    return () => {
      cancelled = true;
    };
  }, [authState, reloadTick]);

  useEffect(() => {
    void deniedRealtimeDocIdsRef.current;
    void realtimeTodoIdsKey;
  }, [realtimeTodoIdsKey]);

  function openCreateDialog() {
    setTaskDialogMode("create");
    setEditingTodoId(null);
    setFormTitle("");
    setFormDescription("");
    setFormPriority("medium");
    setFormAssigneeUids([]);
    setFormUserQuery("");
    setFormUserResults([]);
    setFormUserSearchStatus("idle");
    setTaskDialogOpen(true);
  }

  function openViewDialog(todo: Todo) {
    setTaskDialogMode("view");
    setEditingTodoId(todo.id);
    setFormTitle(todo.title);
    setFormDescription(todo.description ?? "");
    setFormPriority(todo.priority);
    setFormAssigneeUids(todo.assigneeUids);
    setFormUserQuery("");
    setFormUserResults([]);
    setFormUserSearchStatus("idle");
    setTaskDialogOpen(true);
  }

  async function searchUsersForDialog(q: string) {
    if (authState.status !== "signed_in") return;
    setFormUserSearchStatus("loading");
    try {
      const token = await authState.user.getIdToken();
      const res = await fetch(`/api/users?q=${encodeURIComponent(q)}`, {
        headers: {
          authorization: `Bearer ${token}`
        }
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as { users: UserSummary[] };
      setFormUserResults(data.users);
      setFormUserSearchStatus("ok");
    } catch {
      setFormUserResults([]);
      setFormUserSearchStatus("error");
    }
  }

  async function saveTaskDialog() {
    if (authState.status !== "signed_in") return;

    const title = formTitle.trim();
    if (!title) {
      throw new Error("Title is required");
    }

    const description = formDescription.trim();
    const token = await authState.user.getIdToken();

    if (taskDialogMode === "create") {
      const res = await fetch("/api/todos", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          title,
          description,
          priority: formPriority,
          assigneeUids: formAssigneeUids
        })
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const raw = await res.json();
      const parsed = TodoResponseSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error("Invalid /api/todos POST response shape");
      }

      const json = parsed.data as unknown as { todo: Todo };
      setTodosState((prev) => ({ status: "ok", todos: [...prev.todos, json.todo] }));
      setTaskDialogOpen(false);
      return;
    }

    if (taskDialogMode !== "edit") {
      return;
    }

    if (!editingTodoId) {
      throw new Error("Missing todo id");
    }

    const res = await fetch(`/api/todos/${encodeURIComponent(editingTodoId)}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        title,
        description,
        priority: formPriority,
        assigneeUids: formAssigneeUids
      })
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const raw = await res.json();
    const parsed = TodoResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error("Invalid /api/todos PATCH response shape");
    }

    const json = parsed.data as unknown as { todo: Todo };
    setTodosState((prev) => ({
      status: "ok",
      todos: prev.todos.map((t) => (t.id === json.todo.id ? json.todo : t))
    }));
    setTaskDialogOpen(false);
  }

  async function toggleTodo(todo: Todo) {
    if (authState.status !== "signed_in") return;

    const token = await authState.user.getIdToken();
    const nextStatus = todo.status === "done" ? "active" : "done";
    const res = await fetch(`/api/todos/${encodeURIComponent(todo.id)}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ status: nextStatus })
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = (await res.json()) as { todo: Todo };
    setTodosState((prev) => ({
      status: "ok",
      todos: prev.todos.map((t) => (t.id === todo.id ? data.todo : t))
    }));
  }

  function openAssign(todo: Todo) {
    setAssigningTodoId((prev) => {
      const next = prev === todo.id ? null : todo.id;
      if (next) {
        setUserQuery("");
        setUserResults([]);
        setUserSearchStatus("idle");
        void searchUsers("");
        void hydrateUsersByUid(todo.assigneeUids);
      }
      return next;
    });
  }

  async function updatePriority(todo: Todo, priority: "low" | "medium" | "high") {
    if (authState.status !== "signed_in") return;

    const token = await authState.user.getIdToken();
    const res = await fetch(`/api/todos/${encodeURIComponent(todo.id)}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ priority })
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = (await res.json()) as { todo: Todo };
    setTodosState((prev) => ({
      status: "ok",
      todos: prev.todos.map((t) => (t.id === todo.id ? data.todo : t))
    }));
  }

  async function persistReorder(orderedIds: string[]) {
    if (authState.status !== "signed_in") return;

    const token = await authState.user.getIdToken();
    const res = await fetch("/api/todos/reorder", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ orderedIds })
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
  }

  async function hydrateUsersByUid(uids: string[]) {
    if (authState.status !== "signed_in") return;

    const missing = uids.filter((id) => !userCache[id]);
    if (missing.length === 0) return;

    const token = await authState.user.getIdToken();
    const res = await fetch("/api/users/lookup", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ uids: missing })
    });

    if (!res.ok) {
      return;
    }

    const data = (await res.json()) as { users: UserSummary[] };
    setUserCache((prev) => {
      const next = { ...prev };
      for (const u of data.users) {
        next[u.uid] = u;
      }
      return next;
    });
  }

  useEffect(() => {
    if (authState.status !== "signed_in") return;
    const uids = Array.from(
      new Set(
        todosState.todos.flatMap((t) => [t.createdByUid, ...t.assigneeUids]).filter((v): v is string => !!v)
      )
    );
    void hydrateUsersByUid(uids);
  }, [authState, todosState.todos]);

  async function deleteTodo(todo: Todo) {
    if (authState.status !== "signed_in") return;

    const token = await authState.user.getIdToken();
    const res = await fetch(`/api/todos/${encodeURIComponent(todo.id)}`, {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    if (!res.ok && res.status !== 204) {
      throw new Error(`HTTP ${res.status}`);
    }

    setTodosState((prev) => ({ status: "ok", todos: prev.todos.filter((t) => t.id !== todo.id) }));
  }

  async function searchUsers(q: string) {
    if (authState.status !== "signed_in") return;
    setUserSearchStatus("loading");
    try {
      const token = await authState.user.getIdToken();
      const res = await fetch(`/api/users?q=${encodeURIComponent(q)}`, {
        headers: {
          authorization: `Bearer ${token}`
        }
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as { users: UserSummary[] };
      setUserResults(data.users);
      setUserSearchStatus("ok");
    } catch {
      setUserResults([]);
      setUserSearchStatus("error");
    }
  }

  async function updateAssignees(todo: Todo, assigneeUids: string[]) {
    if (authState.status !== "signed_in") return;
    const token = await authState.user.getIdToken();
    const res = await fetch(`/api/todos/${encodeURIComponent(todo.id)}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ assigneeUids })
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = (await res.json()) as { todo: Todo };
    setTodosState((prev) => ({
      status: "ok",
      todos: prev.todos.map((t) => (t.id === todo.id ? data.todo : t))
    }));
  }

  const assigningTodo = useMemo(() => {
    if (!assigningTodoId) return null;
    return todosState.todos.find((t) => t.id === assigningTodoId) ?? null;
  }, [assigningTodoId, todosState.todos]);

  const sortedTodos = useMemo(() => {
    return [...todosState.todos].sort((a, b) => a.position - b.position);
  }, [todosState.todos]);

  const assigningAssigneeLabels = useMemo(() => {
    if (!assigningTodo) return [];
    return assigningTodo.assigneeUids.map((uid) => {
      const u = userCache[uid];
      return u?.email ?? u?.displayName ?? "Unknown";
    });
  }, [assigningTodo, userCache]);

  const authSummary = useMemo(() => {
    if (authState.status === "signed_in") {
      return authState.user.displayName ?? authState.user.email ?? authState.user.uid;
    }
    return null;
  }, [authState]);

  const statusChipColor = (status: Todo["status"]) => {
    return status === "done" ? "success" : "warning";
  };

  function priorityColor(priority: Todo["priority"]) {
    if (priority === "high") return "error";
    if (priority === "low") return "success";
    return "warning";
  }

  function nextPriority(priority: Todo["priority"]): Todo["priority"] {
    if (priority === "low") return "medium";
    if (priority === "medium") return "high";
    return "low";
  }

  function SortableTodoCard({ todo }: { todo: Todo }) {
    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      transition,
      isDragging
    } = useSortable({ id: todo.id });

    const style: CSSProperties = {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.8 : 1
    };

    return (
      <Paper
        ref={setNodeRef}
        variant="outlined"
        sx={{
          p: 1.5,
          borderRadius: 2,
          bgcolor: (theme) =>
            todo.status === "done"
              ? alpha(theme.palette.success.main, 0.10)
              : theme.palette.background.paper,
          borderColor: (theme) =>
            todo.status === "done" ? alpha(theme.palette.success.main, 0.35) : theme.palette.divider,
          ...(isDragging ? { boxShadow: 2 } : null)
        }}
        style={style}
      >
        <Box
          sx={{
            display: { xs: "block", sm: "grid" },
            gridTemplateColumns: {
              xs: "none",
              sm: "40px 44px minmax(0, 1fr) 110px 140px minmax(0, 1fr) 96px"
            },
            alignItems: "center",
            columnGap: 1
          }}
        >
          <Box sx={{ display: "flex", justifyContent: "center" }}>
            <Tooltip title="Drag to reorder" placement="top">
              <IconButton size="small" {...attributes} {...listeners}>
                <DragIndicatorIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>

          <Box sx={{ display: "flex", justifyContent: "center" }}>
            <Checkbox
              checked={todo.status === "done"}
              onChange={() => void toggleTodo(todo).catch(() => {})}
            />
          </Box>

          <Box sx={{ minWidth: 0, overflow: "hidden", py: { xs: 0.5, sm: 0 } }}>
            <Typography
              variant="body2"
              sx={{
                fontWeight: 600,
                textDecoration: todo.status === "done" ? "line-through" : "none",
                color: todo.status === "done" ? "text.secondary" : "text.primary"
              }}
              noWrap
              title={todo.title}
            >
              <Link
                component="button"
                type="button"
                underline="none"
                color="primary"
                onClick={() => openViewDialog(todo)}
                sx={{
                  fontWeight: 600,
                  cursor: "pointer",
                  textAlign: "left",
                  transition: (theme) => theme.transitions.create("color"),
                  "&:hover": {
                    color: "primary.dark"
                  },
                  textDecoration: todo.status === "done" ? "line-through" : "none",
                  textDecorationThickness: "2px",
                  textDecorationColor: todo.status === "done" ? "rgba(0,0,0,0.25)" : "inherit"
                }}
              >
                {todo.title}
              </Link>
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              noWrap
              sx={{ display: "block", overflow: "hidden", textOverflow: "ellipsis" }}
            >
              Created by {userCache[todo.createdByUid]?.email ?? userCache[todo.createdByUid]?.displayName ?? "Unknown"}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              noWrap
              sx={{ display: "block", overflow: "hidden", textOverflow: "ellipsis" }}
            >
              Updated {new Date(todo.updatedAt).toLocaleString()}
            </Typography>
          </Box>

          <Box sx={{ display: "flex", justifyContent: { xs: "flex-start", sm: "center" }, py: { xs: 0.5, sm: 0 } }}>
            <Chip
              size="small"
              label={todo.status === "done" ? "Done" : "Active"}
              color={statusChipColor(todo.status)}
              variant={todo.status === "done" ? "filled" : "outlined"}
            />
          </Box>

          <Box sx={{ display: "flex", justifyContent: { xs: "flex-start", sm: "center" }, py: { xs: 0.5, sm: 0 } }}>
            <Tooltip title={`Priority: ${todo.priority} (click to cycle)`} placement="top">
              <Chip
                size="small"
                icon={<FlagIcon fontSize="small" />}
                label={todo.priority}
                color={priorityColor(todo.priority)}
                variant="outlined"
                onClick={() => void updatePriority(todo, nextPriority(todo.priority)).catch(() => {})}
              />
            </Tooltip>
          </Box>

          <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" sx={{ py: { xs: 0.5, sm: 0 } }}>
            <Tooltip
              title={
                todo.assigneeUids.length === 0
                  ? "Click to assign"
                  : todo.assigneeUids
                      .map((uid) => userCache[uid]?.email ?? userCache[uid]?.displayName ?? "Unknown")
                      .join(", ")
              }
              placement="top"
            >
              <Chip
                size="small"
                clickable
                label={
                  todo.assigneeUids.length === 0
                    ? "Unassigned"
                    : (() => {
                        const labels = todo.assigneeUids.map(
                          (uid) => userCache[uid]?.email ?? userCache[uid]?.displayName ?? "Unknown"
                        );
                        const first = labels[0] ?? "Assigned";
                        if (labels.length <= 1) return first;
                        return `${first} +${labels.length - 1}`;
                      })()
                }
                variant={todo.assigneeUids.length === 0 ? "outlined" : "filled"}
                color={todo.assigneeUids.length === 0 ? "default" : "primary"}
                sx={
                  todo.assigneeUids.length === 0
                    ? undefined
                    : {
                        bgcolor: "primary.main",
                        color: "primary.contrastText",
                        "&:hover": {
                          bgcolor: "primary.dark"
                        }
                      }
                }
                onClick={() => openAssign(todo)}
              />
            </Tooltip>
          </Stack>

          {authState.status === "signed_in" && todo.ownerUid === authState.user.uid && (
            <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ py: { xs: 0.5, sm: 0 } }}>
              <IconButton size="small" onClick={() => void deleteTodo(todo).catch(() => {})} color="error">
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Stack>
          )}
        </Box>
      </Paper>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Stack spacing={3}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
          <Box>
            <Typography variant="h4" fontWeight={700}>
              Collab Todo
            </Typography>
          </Box>
          <Box>
            {authState.status === "signed_out" && (
              <Button
                variant="contained"
                onClick={() => void signInWithGoogle()}
                sx={{
                  textTransform: "uppercase",
                  "&:hover": {
                    bgcolor: "primary.dark"
                  }
                }}
              >
                Sign in with Google
              </Button>
            )}
            {authState.status === "signed_in" && (
              <Stack direction="row" spacing={2} alignItems="center">
                <Typography variant="body2" color="text.secondary">
                  Signed in as {authSummary}
                </Typography>
                <Button
                  variant="outlined"
                  onClick={() => void signOut()}
                  sx={{
                    borderColor: "primary.main",
                    color: "primary.main",
                    "&:hover": {
                      borderColor: "primary.dark",
                      bgcolor: "primary.main",
                      color: "primary.contrastText"
                    }
                  }}
                >
                  Sign out
                </Button>
              </Stack>
            )}
          </Box>
        </Stack>

        <Card>
          <CardContent>
            <Stack spacing={2}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
                <Box>
                  <Typography variant="h6" fontWeight={700}>
                    Todos
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Create, complete, and assign tasks.
                  </Typography>
                </Box>
              </Stack>

              {authState.status !== "signed_in" ? (
                <Alert severity="info">Sign in to manage todos.</Alert>
              ) : (
                <Stack spacing={2}>
                  <Stack direction="row" justifyContent="flex-end">
                    <Button
                      variant="contained"
                      startIcon={<AddIcon />}
                      onClick={openCreateDialog}
                      sx={{
                        textTransform: "uppercase",
                        "&:hover": {
                          bgcolor: "primary.dark"
                        }
                      }}
                    >
                      New task
                    </Button>
                  </Stack>

                  <Box sx={{ height: 4 }}>
                    <LinearProgress sx={{ visibility: todosState.status === "loading" ? "visible" : "hidden" }} />
                  </Box>
                  {todosState.status === "error" && <Alert severity="error">Error: {todosState.message}</Alert>}

                  <Divider />

                  <DndContext
                    collisionDetection={closestCenter}
                    onDragEnd={(event: DragEndEvent) => {
                      const { active, over } = event;
                      if (!over || active.id === over.id) return;

                      setTodosState((prev) => {
                        const current = [...prev.todos].sort((a, b) => a.position - b.position);
                        const oldIndex = current.findIndex((t) => t.id === active.id);
                        const newIndex = current.findIndex((t) => t.id === over.id);
                        if (oldIndex < 0 || newIndex < 0) return prev;

                        const next = arrayMove(current, oldIndex, newIndex).map((t, idx) => ({
                          ...t,
                          position: idx
                        }));

                        const orderedIds = next.map((t) => t.id);
                        void persistReorder(orderedIds).catch(() => {});

                        return { status: "ok", todos: next };
                      });
                    }}
                  >
                    <Box
                      sx={{
                        display: { xs: "none", sm: "grid" },
                        gridTemplateColumns: "40px 44px minmax(0, 1fr) 110px 140px minmax(0, 1fr) 96px",
                        columnGap: 1,
                        px: 1.5,
                        py: 1,
                        color: "text.secondary",
                        typography: "caption"
                      }}
                    >
                      <Box />
                      <Box />
                      <Box>Task</Box>
                      <Box sx={{ textAlign: "center" }}>Status</Box>
                      <Box sx={{ textAlign: "center" }}>Priority</Box>
                      <Box>Assignees</Box>
                      <Box sx={{ textAlign: "right" }}>Remove</Box>
                    </Box>

                    <SortableContext items={sortedTodos.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                      <Stack spacing={1.5}>
                        {sortedTodos.map((t) => (
                          <SortableTodoCard key={t.id} todo={t} />
                        ))}
                      </Stack>
                    </SortableContext>
                  </DndContext>

                  {assigningTodo && (
                    <Box sx={{ mt: 2 }}>
                      <Typography variant="subtitle1" fontWeight={700}>
                        Assign: {assigningTodo.title}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Search by name or email.
                      </Typography>

                      <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ mt: 1 }}>
                        <Box sx={{ flex: 1 }}>
                          <TextField
                            value={userQuery}
                            onChange={(e) => {
                              const q = e.target.value;
                              setUserQuery(q);
                              void searchUsers(q);
                            }}
                            size="small"
                            fullWidth
                            placeholder="Search users…"
                            InputProps={{
                              startAdornment: (
                                <InputAdornment position="start">
                                  <SearchIcon fontSize="small" />
                                </InputAdornment>
                              )
                            }}
                          />

                          <Box sx={{ mt: 1 }}>
                            <Box sx={{ height: 4 }}>
                              <LinearProgress
                                sx={{ visibility: userSearchStatus === "loading" ? "visible" : "hidden" }}
                              />
                            </Box>
                            {userSearchStatus === "error" && <Alert severity="error">Search failed</Alert>}
                            {userSearchStatus === "ok" && userResults.length === 0 && (
                              <Alert severity="info">
                                No users found. Ask the other user to sign in once so they appear in the user list.
                              </Alert>
                            )}
                          </Box>

                          {userResults.length > 0 && (
                            <List dense sx={{ mt: 1, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                              {userResults.map((u) => {
                                const label = u.email ?? u.displayName ?? "Unknown";
                                const already = assigningTodo.assigneeUids.includes(u.uid);
                                return (
                                  <ListItem key={u.uid} disablePadding secondaryAction={already ? <Chip size="small" label="Assigned" /> : null}>
                                    <ListItemButton
                                      disabled={already}
                                      onClick={() =>
                                        void updateAssignees(
                                          assigningTodo,
                                          Array.from(new Set([...assigningTodo.assigneeUids, u.uid]))
                                        ).catch(() => {})
                                      }
                                    >
                                      <ListItemText primary={label} />
                                    </ListItemButton>
                                  </ListItem>
                                );
                              })}
                            </List>
                          )}
                        </Box>

                        <Box sx={{ width: { xs: "100%", md: 360 } }}>
                          <Typography variant="subtitle2" color="text.secondary">
                            Assignees
                          </Typography>
                          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 1 }}>
                            {assigningTodo.assigneeUids.length === 0 ? (
                              <Chip size="small" label="None" variant="outlined" />
                            ) : (
                              assigningTodo.assigneeUids.map((uid, idx) => (
                                <Chip
                                  key={uid}
                                  size="small"
                                  label={assigningAssigneeLabels[idx] ?? uid}
                                  onDelete={() =>
                                    void updateAssignees(
                                      assigningTodo,
                                      assigningTodo.assigneeUids.filter((x) => x !== uid)
                                    ).catch(() => {})
                                  }
                                />
                              ))
                            )}
                          </Stack>
                        </Box>
                      </Stack>
                    </Box>
                  )}

                  <Dialog open={taskDialogOpen} onClose={() => setTaskDialogOpen(false)} fullWidth maxWidth="sm">
                    <DialogTitle>
                      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
                        <Box>
                          {taskDialogMode === "create" && "New task"}
                          {taskDialogMode === "view" && "Task"}
                          {taskDialogMode === "edit" && "Edit task"}
                        </Box>
                        {taskDialogMode === "view" && (
                          <IconButton
                            size="small"
                            onClick={() => setTaskDialogMode("edit")}
                            aria-label="Edit"
                          >
                            <EditIcon fontSize="small" />
                          </IconButton>
                        )}
                      </Stack>
                    </DialogTitle>
                    <DialogContent>
                      <Stack spacing={2} sx={{ mt: 1 }}>
                        {taskDialogMode === "view" ? (
                          <>
                            <Box>
                              <Typography variant="subtitle2" color="text.secondary">
                                Title
                              </Typography>
                              <Typography variant="body1" sx={{ mt: 0.5 }}>
                                {formTitle || "-"}
                              </Typography>
                            </Box>

                            <Box>
                              <Typography variant="subtitle2" color="text.secondary">
                                Description
                              </Typography>
                              <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: "pre-wrap" }}>
                                {formDescription || "-"}
                              </Typography>
                            </Box>

                            <Box>
                              <Typography variant="subtitle2" color="text.secondary">
                                Priority
                              </Typography>
                              <Typography variant="body2" sx={{ mt: 0.5 }}>
                                {formPriority}
                              </Typography>
                            </Box>
                          </>
                        ) : (
                          <>
                            <TextField
                              label="Title"
                              value={formTitle}
                              onChange={(e) => setFormTitle(e.target.value)}
                              fullWidth
                              autoFocus
                            />
                            <TextField
                              label="Description"
                              value={formDescription}
                              onChange={(e) => setFormDescription(e.target.value)}
                              fullWidth
                              multiline
                              minRows={3}
                            />
                            <Select
                              value={formPriority}
                              onChange={(e) => setFormPriority(e.target.value as Todo["priority"])}
                            >
                              <MenuItem value="low">Low</MenuItem>
                              <MenuItem value="medium">Medium</MenuItem>
                              <MenuItem value="high">High</MenuItem>
                            </Select>
                          </>
                        )}

                        <Box>
                          <Typography variant="subtitle2" color="text.secondary">
                            Assignees
                          </Typography>
                          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 1 }}>
                            {formAssigneeUids.length === 0 ? (
                              <Chip size="small" label="Unassigned" variant="outlined" />
                            ) : (
                              formAssigneeUids.map((uid) => {
                                const u = userCache[uid];
                                const label = u?.email ?? u?.displayName ?? "Unknown";
                                return (
                                  <Chip
                                    key={uid}
                                    size="small"
                                    label={label}
                                    onDelete={
                                      taskDialogMode === "edit"
                                        ? () => setFormAssigneeUids((prev) => prev.filter((x) => x !== uid))
                                        : undefined
                                    }
                                  />
                                );
                              })
                            )}
                          </Stack>

                          {taskDialogMode === "edit" && (
                            <>
                              <TextField
                                sx={{ mt: 1 }}
                                value={formUserQuery}
                                onChange={(e) => {
                                  const q = e.target.value;
                                  setFormUserQuery(q);
                                  void searchUsersForDialog(q);
                                }}
                                placeholder="Search users by name or email"
                                fullWidth
                                size="small"
                                InputProps={{
                                  startAdornment: (
                                    <InputAdornment position="start">
                                      <SearchIcon fontSize="small" />
                                    </InputAdornment>
                                  )
                                }}
                              />

                              <Box sx={{ mt: 1 }}>
                                <Box sx={{ height: 4 }}>
                                  <LinearProgress
                                    sx={{ visibility: formUserSearchStatus === "loading" ? "visible" : "hidden" }}
                                  />
                                </Box>
                                {formUserSearchStatus === "error" && <Alert severity="error">Search failed</Alert>}
                              </Box>

                              {formUserResults.length > 0 && (
                                <List dense sx={{ mt: 1, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                                  {formUserResults.map((u) => {
                                    const label = u.email ?? u.displayName ?? "Unknown";
                                    const already = formAssigneeUids.includes(u.uid);
                                    return (
                                      <ListItem
                                        key={u.uid}
                                        disablePadding
                                        secondaryAction={already ? <Chip size="small" label="Added" /> : null}
                                      >
                                        <ListItemButton
                                          disabled={already}
                                          onClick={() => {
                                            setFormAssigneeUids((prev) => Array.from(new Set([...prev, u.uid])));
                                            setUserCache((prev) => ({ ...prev, [u.uid]: u }));
                                          }}
                                        >
                                          <ListItemText primary={label} />
                                        </ListItemButton>
                                      </ListItem>
                                    );
                                  })}
                                </List>
                              )}
                            </>
                          )}
                        </Box>
                      </Stack>
                    </DialogContent>
                    <DialogActions>
                      <Button onClick={() => setTaskDialogOpen(false)}>Cancel</Button>
                      {(taskDialogMode === "create" || taskDialogMode === "edit") && (
                        <Button
                          variant="contained"
                          onClick={() =>
                            void saveTaskDialog().catch((err) => {
                              setTodosState((prev) => ({
                                status: "error",
                                todos: prev.todos,
                                message: err instanceof Error ? err.message : "Unknown error"
                              }));
                            })
                          }
                        >
                          Save
                        </Button>
                      )}
                    </DialogActions>
                  </Dialog>
                </Stack>
              )}
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    </Container>
  );
}
