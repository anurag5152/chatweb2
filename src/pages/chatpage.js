// src/pages/ChatPage.jsx
import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import { useNavigate } from "react-router-dom";
import { getToken, removeToken, authHeader, getUser, setUser, removeUser } from "../utils/auth";

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:5000";
const SOCKET_URL = API_URL;

export default function ChatPage() {
  const navigate = useNavigate();

  // ----------------------------
  // STATE
  // ----------------------------
  const [currentUser, setCurrentUser] = useState(null);
  const [socket, setSocket] = useState(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [friendRequests, setFriendRequests] = useState([]);
  const [friends, setFriends] = useState([]);
  const [activeChat, setActiveChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [newMessage, setNewMessage] = useState("");
  const [sendingFriendEmail, setSendingFriendEmail] = useState(null);
  const [showSidebar, setShowSidebar] = useState(false);

  const messagesEndRef = useRef(null);

  // Ref to avoid stale closures in socket handlers
  const activeChatRef = useRef(activeChat);
  useEffect(() => {
    activeChatRef.current = activeChat;
  }, [activeChat]);

  // Track joined conversation rooms
  const joinedConvosRef = useRef(new Set());

  // ----------------------------
  // SCROLL HELPER
  // ----------------------------
  const scrollToBottom = () => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  };
  useEffect(scrollToBottom, [messages]);

  const refreshMessagesForActive = async (friendParam) => {
    const friend = friendParam || activeChatRef.current;
    if (!friend?.conversation_id) return;
    try {
      const res = await fetch(`${API_URL}/conversations/${friend.conversation_id}/messages`, {
        headers: { ...authHeader(), Accept: "application/json" },
      });
      const data = await res.json();
      let normalized = (data.messages || data).map((m) => ({
        ...m,
        timestamp: m.timestamp || m.created_at || new Date().toISOString(),
      }));
      // Ensure ascending chronological order by timestamp
      normalized.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      setMessages(normalized);
    } catch {
      setMessages([]);
    }
  };

  // ----------------------------
  // AUTH & INITIAL LOAD
  // ----------------------------
  useEffect(() => {
    const token = getToken();
    if (!token) return navigate("/login", { replace: true });

    const cached = getUser();
    if (cached) setCurrentUser(cached);

    fetch(`${API_URL}/me`, { headers: { ...authHeader(), Accept: "application/json" } })
      .then((res) => {
        if (!res.ok) throw new Error("unauthenticated");
        return res.json();
      })
      .then((user) => {
        setCurrentUser(user);
        try { setUser(user); } catch {}
        connectSocket(user, token);
        loadFriends(token);
        loadRequests(token);
      })
      .catch(() => {
        removeToken();
        navigate("/login", { replace: true });
      });

    return () => {
      if (socket) {
        socket.off();
        socket.disconnect();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----------------------------
  // SOCKET CONNECTION
  // ----------------------------
  const connectSocket = (user, token) => {
    if (!token) return;

    // Disconnect existing socket if any
    if (socket) {
      socket.off();
      socket.disconnect();
      setSocket(null);
    }

    const s = io(SOCKET_URL, {
      auth: { token },
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    s.on("connect", () => {
      console.log("Socket connected:", s.id);
      setSocketConnected(true);

      // Rejoin all previously joined rooms on reconnect
      joinedConvosRef.current.forEach((cid) => s.emit("join", { conversationId: cid }));
    });

    s.on("disconnect", () => setSocketConnected(false));
    s.on("connect_error", (err) => console.warn("Socket connect error:", err?.message || err));

    // Incoming message handler
    const incomingHandler = (msg) => {
      const normalized = {
        ...msg,
        timestamp: msg.timestamp || msg.created_at || new Date().toISOString(),
      };
      // Ignore deleted messages entirely
      if (normalized.deleted === true || normalized.content === "Message deleted") return;

      const convoId = normalized.conversation_id ?? normalized.conversationId ?? normalized.conversation;

      if (activeChatRef.current && convoId === activeChatRef.current.conversation_id) {
        setMessages((prev) => {
          // Check if there's an optimistic message with same content
          const index = prev.findIndex(
            (m) => m.id?.startsWith("tmp-") && m.content === normalized.content
          );

          if (index !== -1) {
            // Replace optimistic with server-confirmed message
            const updated = [...prev];
            updated[index] = { ...normalized };
            return updated;
          } else {
            // Append normally
            return [...prev, normalized];
          }
        });
      } else {
        // Handle messages for other chats here (like unread counts)
        // incrementUnread(convoId);
      }
    };

    s.on("message", incomingHandler);
    s.on("receiveMessage", incomingHandler);

    // Friend updates
    s.on("friendUpdate", () => {
      const t = getToken();
      if (t) {
        loadFriends(t);
        loadRequests(t);
      }
    });

    setSocket(s);
  };

  // ----------------------------
  // API LOADERS
  // ----------------------------
  const loadFriends = (token) => {
    fetch(`${API_URL}/conversations`, { headers: { ...authHeader(), Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        const convs = data.conversations || data;
        setFriends(
          convs.map((c) => ({
            id: c.other_user_id,
            name: c.other_user_name,
            email: c.other_user_email,
            conversation_id: c.id,
          }))
        );
      })
      .catch(() => setFriends([]));
  };

  const loadRequests = (token) => {
    fetch(`${API_URL}/friends/requests`, { headers: { ...authHeader(), Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (Array.isArray(data)) setFriendRequests(data);
        else if (Array.isArray(data.requests)) setFriendRequests(data.requests);
        else setFriendRequests([]);
      })
      .catch(() => setFriendRequests([]));
  };

  // ----------------------------
  // SEARCH USERS
  // ----------------------------
  useEffect(() => {
    const query = searchQuery.trim();
    if (query.length < 3) {
      setSearchResults([]);
      return;
    }

    const controller = new AbortController();
    const isEmailLike = query.includes('@');
    const isFullEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(query);

    const endpoint = `${API_URL}/users/search?q=${encodeURIComponent(query)}`;

    const timeout = setTimeout(() => {
      fetch(endpoint, {
        headers: { ...authHeader(), Accept: "application/json" },
        signal: controller.signal,
      })
        .then((res) => (res.ok ? res.json() : []))
        .then((data) => {
          const users = Array.isArray(data) ? data : (data?.users || []);

          let filtered = users.filter((u) => u && u.email);

          // Exclude current user safely
          const me = currentUser?.email?.toLowerCase();
          if (me) filtered = filtered.filter((u) => u.email.toLowerCase() !== me);

          // If a full email is typed, only show exact match
          if (isEmailLike && isFullEmail) {
            const ql = query.toLowerCase();
            filtered = filtered.filter((u) => u.email.toLowerCase() === ql);
          }

          setSearchResults(filtered);
        })
        .catch(() => {
          // Treat errors (including 404s) as no results; avoid noisy console
          setSearchResults([]);
        });
    }, 300);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [searchQuery, currentUser]);

  // ----------------------------
  // FRIEND REQUESTS
  // ----------------------------
  const handleSendFriendRequest = (email) => {
    const token = getToken();
    if (!token) return navigate("/login", { replace: true });

    // Optimistic mark as requested
    const lower = email.toLowerCase();
    setSearchResults((prev) => prev.map((u) => (u.email.toLowerCase() === lower ? { ...u, requested: true } : u)));
    setSendingFriendEmail(lower);

    fetch(`${API_URL}/friends/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ receiverEmail: email }),
    })
      .then(async (res) => {
        // Treat 409 (already exists) as success to keep UI consistent
        if (res.status === 409) return { ok: true, already: true };
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.error || "Request failed");
        }
        return res.json();
      })
      .then(() => {
        loadRequests(token);
        loadFriends(token);
      })
      .catch(() => {
        // Revert optimistic change on hard error (not 409)
        setSearchResults((prev) => prev.map((u) => (u.email.toLowerCase() === lower ? { ...u, requested: false } : u)));
      })
      .finally(() => setSendingFriendEmail(null));
  };

  const respondToFriendRequest = (requestId, action) => {
    fetch(`${API_URL}/friends/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ requestId, action }),
    })
      .then((res) => res.json())
      .then((data) => {
        loadRequests(getToken());
        loadFriends(getToken());
        if (data?.conversationId && socket?.connected) {
          socket.emit("join", { conversationId: data.conversationId });
          joinedConvosRef.current.add(data.conversationId);
        }
      });
  };

  const handleAcceptFriendRequest = (id) => respondToFriendRequest(id, "accept");
  const handleRejectFriendRequest = (id) => respondToFriendRequest(id, "reject");

  // Remove friend (also deletes conversation + messages server-side)
  const handleRemoveFriend = async (friend) => {
    const token = getToken();
    if (!token || !friend?.id) return;

    // Optimistic: remove from list and clear active chat if matches
    setFriends((prev) => prev.filter((f) => f.id !== friend.id));
    if (activeChat?.id === friend.id) {
      setActiveChat(null);
      setMessages([]);
    }

    try {
      const res = await fetch(`${API_URL}/friends/remove`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ friendId: friend.id }),
      });
      if (!res.ok) throw new Error("remove failed");
      // Server emits friendUpdate to both users; refresh local as well
      loadFriends(token);
      loadRequests(token);
    } catch (e) {
      // Re-fetch to restore accurate state on failure
      loadFriends(token);
      loadRequests(token);
    }
  };

  // ----------------------------
  // MESSAGING
  // ----------------------------
  const selectFriend = async (friend) => {
    setActiveChat(friend);
    setMessages([]);
    setLoadingMessages(true);
    setShowSidebar(false);

    if (!friend?.conversation_id) return setLoadingMessages(false);

    try {
      await refreshMessagesForActive(friend);
    } finally {
      setLoadingMessages(false);
    }

    // Join conversation room
    if (socket && friend.conversation_id) {
      socket.emit("join", { conversationId: friend.conversation_id });
      joinedConvosRef.current.add(friend.conversation_id);
    }
  };

  const handleSendMessage = () => {
    if (!newMessage.trim() || !activeChat?.conversation_id) return;

    const payload = { conversationId: activeChat.conversation_id, content: newMessage.trim() };

    const optimistic = {
      id: `tmp-${Date.now()}`,
      conversation_id: payload.conversationId,
      sender_id: currentUser.id,
      content: payload.content,
      timestamp: new Date().toISOString(),
      // no reply metadata
    };
    setMessages((prev) => [...prev, optimistic]);

    if (socket?.connected) socket.emit("sendMessage", payload);
    else {
      fetch(`${API_URL}/conversations/${payload.conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ content: payload.content }),
      }).then(() => refreshMessagesForActive(activeChat));
    }

    setNewMessage("");
  };

  const formatTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const groupMessagesByDate = (msgs) =>
    msgs.reduce((g, m) => {
      const d = new Date(m.timestamp).toDateString();
      g[d] = g[d] || [];
      g[d].push(m);
      return g;
    }, {});

  const handleLogout = () => {
    removeToken();
    try { removeUser(); } catch {}
    socket?.disconnect();
    navigate("/login", { replace: true });
  };

  // ----------------------------
  // RENDER
  // ----------------------------
  if (!currentUser)
    return (
      <div className="flex items-center justify-center h-screen text-gray-400 bg-[#0D1117]">
        Loading...
      </div>
    );

  return (
    <div className="flex h-screen bg-[#0D1117] text-[#E6EDF3] font-sans">
      <style>{`
        .themed-scroll { scrollbar-width: thin; scrollbar-color: #234 #06131a; }
        .themed-scroll::-webkit-scrollbar { width: 10px; height: 10px; }
        .themed-scroll::-webkit-scrollbar-track { background: #06131a; }
        .themed-scroll::-webkit-scrollbar-thumb { background: #123; border-radius: 8px; border: 2px solid #06131a; }
        .themed-scroll::-webkit-scrollbar-thumb:hover { background: #1f2c3a; }
      `}</style>
      {/* LEFT SIDEBAR - desktop */}
      <aside className="hidden md:flex w-1/4 flex-col bg-[#071017] border-r border-gray-800 themed-scroll">
        <div className="p-4 border-b border-gray-800">
          <div className="text-lg font-semibold">{currentUser.name}</div>
          <div className="text-xs text-gray-400">{currentUser.email}</div>
          <div className="mt-3">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search users by email..."
              className="w-full p-2 bg-[#061018] border border-[#123] rounded text-sm"
            />
          </div>
        </div>

        {/* Search Results */}
        {searchResults.length > 0 && (
          <div className="p-3 border-b border-gray-800">
            <div className="text-sm text-[#00FF99] mb-2 font-semibold">Search Results</div>
            <ul>
              {searchResults.map((u) => {
                const isFriend = friends.some((f) => f.email === u.email);
                const alreadyRequested =
                  u.requested === true || friendRequests.some((req) => req.email === u.email);
                const isMe = currentUser && u.email.toLowerCase() === currentUser.email.toLowerCase();
                const pendingThis = sendingFriendEmail && sendingFriendEmail === u.email.toLowerCase();

                return (
                  <li key={u.id} className="flex items-center justify-between p-2 hover:bg-[#07171b] rounded">
                    <div>
                      <div className="font-medium">{u.name}</div>
                      <div className="text-xs text-gray-400">{u.email}</div>
                    </div>

                    {isMe ? (
                      <span className="text-xs text-gray-500">You</span>
                    ) : !isFriend && !alreadyRequested ? (
                      <button
                        onClick={() => handleSendFriendRequest(u.email)}
                        className="px-3 py-1 rounded bg-[#0b2] text-black text-sm"
                        disabled={pendingThis}
                      >
                        {pendingThis ? "Sending..." : "Add"}
                      </button>
                    ) : (
                      <span className="text-xs text-gray-500">{isFriend ? "Friend" : "Requested"}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Friend Requests */}
        <div className="p-3 border-b border-gray-800">
          <div className="text-sm text-[#00FF99] mb-2 font-semibold">Friend Requests</div>
          {friendRequests.length > 0 ? (
            <ul>
              {friendRequests.map((req) => (
                <li key={req.id} className="flex items-center justify-between p-2 hover:bg-[#07171b] rounded">
                  <div>
                    <div className="font-medium">{req.name}</div>
                    <div className="text-xs text-gray-400">{req.email}</div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => handleAcceptFriendRequest(req.id)} className="px-2 py-1 rounded bg-green-500 text-black text-sm">
                      Accept
                    </button>
                    <button onClick={() => handleRejectFriendRequest(req.id)} className="px-2 py-1 rounded bg-red-500 text-black text-sm">
                      Reject
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-xs text-gray-500">No requests</div>
          )}
        </div>

        {/* Friends List */}
        <div className="p-3 flex-1 overflow-y-auto themed-scroll">
          <div className="text-sm text-[#00FF99] font-semibold mb-2">Friends</div>
          {friends.length > 0 ? (
            <ul>
              {friends.map((f) => (
                <li
                  key={f.id}
                  className={`flex items-center justify-between p-2 rounded hover:bg-[#07171b] ${
                    activeChat?.id === f.id ? "bg-[#07171b] border-l-4 border-[#00FF99]" : ""
                  }`}
                >
                  <div className="flex-1 cursor-pointer" onClick={() => selectFriend(f)}>
                    <div className="font-medium">{f.name}</div>
                    <div className="text-xs text-gray-400">{f.email}</div>
                  </div>
                  <button
                    onClick={() => handleRemoveFriend(f)}
                    className="ml-3 px-2 py-1 bg-red-600 text-white rounded text-xs"
                    title="Remove friend"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-xs text-gray-500">No friends yet</div>
          )}
        </div>
      </aside>

      {/* Mobile Sidebar Drawer */}
      {showSidebar && (
        <div className="md:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowSidebar(false)} />
          <div className="absolute left-0 top-0 h-full w-4/5 max-w-xs bg-[#071017] border-r border-gray-800 p-0 overflow-y-auto themed-scroll">
            <div className="p-4 border-b border-gray-800 flex items-center justify-between">
              <div className="text-lg font-semibold">Menu</div>
              <button onClick={() => setShowSidebar(false)} className="text-gray-300">✕</button>
            </div>
            <div className="p-4 border-b border-gray-800">
              <div className="text-lg font-semibold">{currentUser.name}</div>
              <div className="text-xs text-gray-400">{currentUser.email}</div>
              <div className="mt-3">
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search users by email..."
                  className="w-full p-2 bg-[#061018] border border-[#123] rounded text-sm"
                />
              </div>
            </div>
            {searchResults.length > 0 && (
              <div className="p-3 border-b border-gray-800">
                <div className="text-sm text-[#00FF99] mb-2 font-semibold">Search Results</div>
                <ul>
                  {searchResults.map((u) => {
                    const isFriend = friends.some((f) => f.email === u.email);
                    const alreadyRequested =
                      u.requested === true || friendRequests.some((req) => req.email === u.email);
                    const isMe = currentUser && u.email.toLowerCase() === currentUser.email.toLowerCase();
                    const pendingThis = sendingFriendEmail && sendingFriendEmail === u.email.toLowerCase();
                    return (
                      <li key={u.id} className="flex items-center justify-between p-2 hover:bg-[#07171b] rounded">
                        <div>
                          <div className="font-medium">{u.name}</div>
                          <div className="text-xs text-gray-400">{u.email}</div>
                        </div>
                        {isMe ? (
                          <span className="text-xs text-gray-500">You</span>
                        ) : !isFriend && !alreadyRequested ? (
                          <button
                            onClick={() => handleSendFriendRequest(u.email)}
                            className="px-3 py-1 rounded bg-[#0b2] text-black text-sm"
                            disabled={pendingThis}
                          >
                            {pendingThis ? "Sending..." : "Add"}
                          </button>
                        ) : (
                          <span className="text-xs text-gray-500">{isFriend ? "Friend" : "Requested"}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            <div className="p-3 border-b border-gray-800">
              <div className="text-sm text-[#00FF99] mb-2 font-semibold">Friend Requests</div>
              {friendRequests.length > 0 ? (
                <ul>
                  {friendRequests.map((req) => (
                    <li key={req.id} className="flex items-center justify-between p-2 hover:bg-[#07171b] rounded">
                      <div>
                        <div className="font-medium">{req.name}</div>
                        <div className="text-xs text-gray-400">{req.email}</div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => handleAcceptFriendRequest(req.id)} className="px-2 py-1 rounded bg-green-500 text-black text-sm">
                          Accept
                        </button>
                        <button onClick={() => handleRejectFriendRequest(req.id)} className="px-2 py-1 rounded bg-red-500 text-black text-sm">
                          Reject
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-xs text-gray-500">No requests</div>
              )}
            </div>
            <div className="p-3">
              <div className="text-sm text-[#00FF99] font-semibold mb-2">Friends</div>
              {friends.length > 0 ? (
                <ul>
                  {friends.map((f) => (
                    <li
                      key={f.id}
                      className={`flex items-center justify-between p-2 rounded hover:bg-[#07171b] ${
                        activeChat?.id === f.id ? "bg-[#07171b] border-l-4 border-[#00FF99]" : ""
                      }`}
                    >
                      <div className="flex-1 cursor-pointer" onClick={() => selectFriend(f)}>
                        <div className="font-medium">{f.name}</div>
                        <div className="text-xs text-gray-400">{f.email}</div>
                      </div>
                      <button
                        onClick={() => handleRemoveFriend(f)}
                        className="ml-3 px-2 py-1 bg-red-600 text-white rounded text-xs"
                        title="Remove friend"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-xs text-gray-500">No friends yet</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* RIGHT CHAT PANEL */}
      <div className="flex-1 flex flex-col">
        <header className="p-4 border-b border-gray-800 flex items-center justify-between bg-[#041018]">
          <div className="flex items-center gap-3">
            <button className="md:hidden px-2 py-1 bg-[#061018] rounded" onClick={() => setShowSidebar(true)}>
              ☰
            </button>
            <div>
              <div className="text-lg font-semibold">{activeChat ? activeChat.name : "Select a friend"}</div>
              <div className="text-xs text-gray-400">{activeChat ? activeChat.email : ""}</div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-xs text-gray-300">
              <span className={`w-3 h-3 rounded-full ${socketConnected ? "bg-green-400" : "bg-red-500"}`} />
              <span>{socketConnected ? "Connected" : "Disconnected"}</span>
            </div>
            <button onClick={handleLogout} className="px-3 py-1 bg-[#061018] rounded">
              Logout
            </button>
          </div>
        </header>

        {activeChat ? (
          <>
            <main className="flex-1 overflow-y-auto themed-scroll p-4 bg-[#06131a]">
              {loadingMessages ? (
                <div className="flex items-center justify-center h-full text-gray-400">Loading messages...</div>
              ) : (
                <>
                  {Object.entries(groupMessagesByDate(messages)).map(([date, msgs]) => (
                    <div key={date}>
                      <div className="text-center text-xs text-gray-400 my-4">{date}</div>
                      {msgs.map((m) => {
                        const isMine = m.sender_id === currentUser.id;
                        return (
                          <div key={m.id || Math.random()} className={`flex mb-4 ${isMine ? "justify-end" : "justify-start"}`}>
                            <div className={`p-3 rounded-xl max-w-md ${isMine ? "bg-[#1f8b5a] text-white" : "bg-[#0e1619] text-[#E6EDF3]"}`}>
                              <div>{m.content}</div>
                              <div className="text-xs text-gray-400 mt-1">{formatTime(m.timestamp)}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </>
              )}
            </main>

            <footer className="p-4 border-t border-gray-800 flex flex-col gap-2 bg-[#041018]">
              <input
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Type a message..."
                className="flex-1 p-2 bg-[#061018] border border-[#123] rounded text-sm"
                onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
              />
              <button onClick={handleSendMessage} className="px-4 py-2 bg-[#0b2] text-black rounded">
                Send
              </button>
            </footer>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">Select a friend to chat</div>
        )}
      </div>
    </div>
  );
}

/*
==============================
SOCKET ISSUE EXPLANATION
==============================
1. Messages were not appearing live because the socket handler closed over a stale `activeChat` state.
2. On refresh, state was fresh so messages appeared.
3. FIX:
   - Use `activeChatRef` inside socket.on to always access the latest chat.
   - Track joined rooms in `joinedConvosRef` to rejoin on reconnect.
   - Optimistic UI ensures sending messages is immediate.
*/
