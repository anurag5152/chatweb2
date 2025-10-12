// src/pages/ChatPage.jsx
import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import { useNavigate } from "react-router-dom";
import { getToken, removeToken, authHeader, getUser } from "../utils/auth";

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:5000";
const SOCKET_URL = API_URL;

export default function ChatPage() {
  const navigate = useNavigate();

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
  const [sendingFriendEmail, setSendingFriendEmail] = useState(null); // for disabling Add
  const messagesEndRef = useRef(null);

  // helper to scroll to bottom
  const scrollToBottom = () => {
    try {
      if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
      }
    } catch (e) {}
  };

  // ----------------------------
  // AUTH + INITIAL LOAD
  // ----------------------------
  useEffect(() => {
    const token = getToken();
    if (!token) {
      navigate("/login", { replace: true });
      return;
    }

    // optimistic: if user stored locally, use it while /me resolves
    const cached = getUser();
    if (cached) setCurrentUser(cached);

    fetch(`${API_URL}/me`, {
      headers: { ...authHeader(), Accept: "application/json" },
    })
      .then((res) => {
        if (!res.ok) throw new Error("unauthenticated");
        return res.json();
      })
      .then((user) => {
        setCurrentUser(user);
        // connect socket after we have user info and token
        connectSocket(user, token);
        loadFriends(token);
        loadRequests(token);
      })
      .catch(() => {
        removeToken();
        navigate("/login", { replace: true });
      });

    // cleanup when leaving page: disconnect socket if any
    return () => {
      if (socket) {
        try {
          socket.off();
          socket.disconnect();
        } catch (e) {}
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount

  // ----------------------------
  // SOCKET CONNECTION
  // ----------------------------
  const connectSocket = (user, token) => {
    if (!token) return;

    // If already connected, disconnect first to avoid duplicates
    if (socket) {
      try {
        socket.off();
        socket.disconnect();
      } catch (e) {}
      setSocket(null);
    }

    // Do NOT force transports: allow polling fallback -> avoids ws issues in dev/proxies
    const s = io(SOCKET_URL, {
      auth: { token },
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    s.on("connect", () => {
      console.info("socket connected", s.id);
      setSocketConnected(true);
    });
    s.on("disconnect", (reason) => {
      console.warn("socket disconnected", reason);
      setSocketConnected(false);
    });
    s.on("connect_error", (err) => {
      console.warn("Socket connect error:", err?.message || err);
    });

    // unify incoming message handler (handle both 'message' and 'receiveMessage')
    const incomingHandler = (msg) => {
      const normalized = {
        ...msg,
        timestamp: msg.timestamp || msg.created_at || new Date().toISOString(),
      };

      // if active chat matches this conversation, append; otherwise can handle unread counts
      if (activeChat && normalized.conversation_id === activeChat.conversation_id) {
        setMessages((prev) => [...prev, normalized]);
      } else {
        // TODO: increment unread counters or badge; for now we ignore
      }
    };

    s.on("message", incomingHandler);
    s.on("receiveMessage", incomingHandler);

    // friend updates: refresh lists
    s.on("friendUpdate", () => {
      const t = getToken();
      if (t) {
        loadFriends(t);
        loadRequests(t);
      }
    });

    setSocket(s);
  };

  // cleanup and scroll on messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // disconnect socket on unmount
  useEffect(() => {
    return () => {
      if (socket) {
        socket.off();
        socket.disconnect();
      }
    };
  }, [socket]);

  // ----------------------------
  // API LOADERS
  // ----------------------------
  const loadFriends = (token) => {
    fetch(`${API_URL}/conversations`, {
      headers: { ...authHeader(), Accept: "application/json" },
    })
      .then((r) => {
        if (!r.ok) throw new Error("failed to load conversations");
        return r.json();
      })
      .then((data) => {
        const convs = data.conversations || data;
        const friendsList = convs.map((c) => ({
          id: c.other_user_id,
          name: c.other_user_name,
          email: c.other_user_email,
          conversation_id: c.id,
          created_at: c.created_at,
        }));
        setFriends(friendsList);
      })
      .catch((err) => {
        console.error("loadFriends error", err);
        setFriends([]);
      });
  };

  const loadRequests = (token) => {
    fetch(`${API_URL}/friends/requests`, {
      headers: { ...authHeader(), Accept: "application/json" },
    })
      .then((r) => {
        if (!r.ok) throw new Error("failed to load friend requests");
        return r.json();
      })
      .then((data) => {
        if (Array.isArray(data)) setFriendRequests(data);
        else if (Array.isArray(data.requests)) setFriendRequests(data.requests);
        else setFriendRequests([]);
      })
      .catch((err) => {
        console.error("loadRequests error", err);
        setFriendRequests([]);
      });
  };

  // ----------------------------
  // SEARCH USERS (debounced)
  // ----------------------------
  useEffect(() => {
    if (searchQuery.trim().length < 3) {
      setSearchResults([]);
      return;
    }
    const controller = new AbortController();
    const q = searchQuery.trim();

    const timeout = setTimeout(() => {
      const url = `${API_URL}/users/search?q=${encodeURIComponent(q)}`;
      console.debug("[search] url=", url);

      fetch(url, { headers: { ...authHeader(), Accept: "application/json" }, signal: controller.signal })
        .then((res) => {
          console.debug("[search] status", res.status);
          if (!res.ok) {
            return res.json().then((b) => {
              throw new Error(b.error || `search failed (${res.status})`);
            }).catch(() => { // if not json
              throw new Error(`search failed (${res.status})`);
            });
          }
          return res.json();
        })
        .then((data) => {
          const users = Array.isArray(data) ? data : data.users || [];
          // optionally filter out current user from results (but we still guard later)
          const filtered = users.filter((u) => {
            if (!currentUser) return true;
            return u.email.toLowerCase() !== currentUser.email.toLowerCase();
          });
          setSearchResults(filtered);
        })
        .catch((err) => {
          if (err.name === "AbortError") return;
          console.error("[search] error", err);
          setSearchResults([]);
        });
    }, 150);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  // ----------------------------
  // FRIEND REQUESTS
  // ----------------------------
  const handleSendFriendRequest = (email) => {
    const token = getToken();
    if (!token) {
      navigate("/login", { replace: true });
      return;
    }

    // client-side guard: prevent sending to yourself
    const myEmail = (currentUser?.email || "").toLowerCase();
    const targetEmail = (email || "").toLowerCase();
    if (myEmail && myEmail === targetEmail) {
      console.warn("Cannot send friend request to yourself (client guard)");
      return;
    }

    setSendingFriendEmail(targetEmail);

    fetch(`${API_URL}/friends/request`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeader(),
      },
      body: JSON.stringify({ receiverEmail: email }),
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          console.warn("friend request failed", res.status, body);
          const err = new Error(body.error || `request failed (${res.status})`);
          err.status = res.status;
          err.body = body;
          throw err;
        }
        return body;
      })
      .then(() => {
        // mark requested locally
        setSearchResults((prev) =>
          prev.map((u) => (u.email.toLowerCase() === targetEmail ? { ...u, requested: true } : u))
        );

        const t = getToken();
        if (t) {
          loadRequests(t);
          loadFriends(t);
        }
      })
      .catch((err) => {
        if (err?.status === 409) {
          // already requested
          setSearchResults((prev) =>
            prev.map((u) => (u.email.toLowerCase() === targetEmail ? { ...u, requested: true } : u))
          );
          setSendingFriendEmail(null);
          return;
        }
        console.error("send friend request err", err);
        setSendingFriendEmail(null);
      })
      .finally(() => {
        setSendingFriendEmail(null);
      });
  };

  // accept/reject via single respond endpoint
  const respondToFriendRequest = (requestId, action) => {
    if (!["accept", "reject"].includes(action)) return;
    const token = getToken();
    fetch(`${API_URL}/friends/respond`, {
      method: "POST",
      headers: { ...authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, action }),
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          console.error("friends.respond non-OK", res.status, body);
          const err = new Error(body.error || `respond failed (${res.status})`);
          err.status = res.status;
          err.body = body;
          throw err;
        }
        return body;
      })
      .then((data) => {
        // refresh lists
        const t = getToken();
        if (t) {
          loadFriends(t);
          loadRequests(t);
        }
        // if accepted, join conversation room via socket (if returned)
        if (data && data.conversationId && socket && socket.connected) {
          socket.emit("join", { conversationId: data.conversationId });
        }
      })
      .catch((err) => {
        console.error("friends.respond err", err);
      });
  };

  const handleAcceptFriendRequest = (id) => respondToFriendRequest(id, "accept");
  const handleRejectFriendRequest = (id) => respondToFriendRequest(id, "reject");

  const handleRemoveFriend = (friendId) => {
    // server doesn't have remove endpoint in your posted server.js
    // just refresh conversations to reflect server state
    const t = getToken();
    if (t) loadFriends(t);
  };

  // ----------------------------
  // MESSAGING
  // ----------------------------
  const selectFriend = async (friend) => {
    setActiveChat(friend);
    setMessages([]);
    setLoadingMessages(true);

    const token = getToken();
    if (!friend?.conversation_id) {
      // No conversation yet (maybe accepted but conversation not created?) show empty chat
      setLoadingMessages(false);
      setMessages([]);
      return;
    }
    try {
      const res = await fetch(`${API_URL}/conversations/${friend.conversation_id}/messages`, {
        headers: { ...authHeader(), Accept: "application/json" },
      });
      if (!res.ok) throw new Error("failed to fetch messages");
      const data = await res.json();
      const msgs = Array.isArray(data) ? data : data.messages || data;
      const normalized = msgs.map((m) => ({
        ...m,
        timestamp: m.timestamp || m.created_at || new Date().toISOString(),
      }));
      // messages endpoint returns newest first; reverse to show oldest -> newest
      setMessages(normalized.reverse ? normalized.reverse() : normalized);
    } catch (err) {
      console.error("selectFriend fetch messages err", err);
      setMessages([]);
    } finally {
      setLoadingMessages(false);
    }

    // join socket room so realtime events come in
    if (socket && friend.conversation_id) {
      socket.emit("join", { conversationId: friend.conversation_id });
    }
  };

  const handleSendMessage = () => {
    if (!newMessage.trim() || !activeChat) return;
    if (!activeChat.conversation_id) {
      console.warn("No conversation available for this friend yet.");
      return;
    }

    const payload = {
      conversationId: activeChat.conversation_id,
      content: newMessage.trim(),
    };

    // optimistic UI append
    const optimistic = {
      id: `tmp-${Date.now()}`,
      conversation_id: payload.conversationId,
      sender_id: currentUser?.id,
      content: payload.content,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);

    // emit to socket (server expects {conversationId, content})
    if (socket && socket.connected) {
      socket.emit("sendMessage", payload, (ack) => {
        // optional ack handling
      });
    } else {
      // fallback to REST POST if socket down
      fetch(`${API_URL}/conversations/${payload.conversationId}/messages`, {
        method: "POST",
        headers: { ...authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({ content: payload.content }),
      })
        .then((res) => {
          if (!res.ok) throw new Error("fallback send failed");
          return res.json();
        })
        .then((data) => {
          // server returns message; ideally replace optimistic message with server one
          // For simplicity, we'll reload messages for the convo
          selectFriend(activeChat);
        })
        .catch((err) => {
          console.error("fallback send err", err);
        });
    }

    setNewMessage("");
  };

  // ----------------------------
  // HELPERS
  // ----------------------------
  const formatTime = (iso) =>
    new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const groupMessagesByDate = (msgs) => {
    return msgs.reduce((groups, m) => {
      const date = new Date(m.timestamp).toDateString();
      if (!groups[date]) groups[date] = [];
      groups[date].push(m);
      return groups;
    }, {});
  };

  const unreadFor = (friendId) => {
    // placeholder - returns 0. Implement using server unread counts or local state if needed.
    return 0;
  };

  const handleLogout = () => {
    removeToken();
    try {
      localStorage.removeItem("chat_user");
    } catch (e) {}
    if (socket) {
      try {
        socket.disconnect();
      } catch (e) {}
    }
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
      {/* LEFT SIDEBAR */}
      <aside className="w-1/4 flex flex-col bg-[#071017] border-r border-gray-800">
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

        {/* Friends */}
        <div className="p-3 flex-1 overflow-y-auto">
          <div className="text-sm text-[#00FF99] font-semibold mb-2">Friends</div>
          {friends.length > 0 ? (
            <ul>
              {friends.map((f) => (
                <li
                  key={f.id}
                  onClick={() => selectFriend(f)}
                  className={`flex items-center justify-between p-2 rounded cursor-pointer hover:bg-[#07171b] ${
                    activeChat?.id === f.id ? "bg-[#07171b] border-l-4 border-[#00FF99]" : ""
                  }`}
                >
                  <div>
                    <div className="font-medium">{f.name}</div>
                    <div className="text-xs text-gray-400">{f.email}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {unreadFor(f.id) > 0 && <span className="bg-red-500 text-xs px-2 py-0.5 rounded">{unreadFor(f.id)}</span>}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveFriend(f.id);
                      }}
                      className="text-xs px-2 py-1 bg-[#220000] rounded"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-xs text-gray-500">No friends yet</div>
          )}
        </div>
      </aside>

      {/* RIGHT CHAT PANEL */}
      <div className="flex-1 flex flex-col">
        <header className="p-4 border-b border-gray-800 flex items-center justify-between bg-[#041018]">
          <div className="flex items-center gap-3">
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
            <main className="flex-1 overflow-y-auto p-4 bg-[#06131a]">
              {loadingMessages ? (
                <div className="flex items-center justify-center h-full text-gray-400">Loading messages...</div>
              ) : (
                <>
                  {Object.entries(groupMessagesByDate(messages)).map(([date, msgs]) => (
                    <div key={date}>
                      <div className="text-center text-xs text-gray-400 my-4">{date}</div>
                      {msgs.map((m) => (
                        <div key={m.id || Math.random()} className={`flex mb-4 ${m.sender_id === currentUser.id ? "justify-end" : "justify-start"}`}>
                          <div className={`p-3 rounded-xl max-w-md ${m.sender_id === currentUser.id ? "bg-[#1f8b5a] text-white" : "bg-[#0e1619] text-[#E6EDF3]"}`}>
                            <div>{m.content}</div>
                            <div className="text-xs text-gray-400 mt-1">{formatTime(m.timestamp)}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </>
              )}
            </main>

            <footer className="p-4 border-t border-gray-800 bg-[#041018]">
              <div className="flex gap-2">
                <input
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyDown={(e) => (e.key === "Enter" ? handleSendMessage() : null)}
                  placeholder={socketConnected ? "Type a message..." : "Disconnected — trying to reconnect..."}
                  className="flex-1 p-3 rounded bg-[#061018] text-white outline-none"
                  disabled={!socketConnected}
                />
                <button onClick={handleSendMessage} disabled={!newMessage.trim() || !socketConnected} className="px-4 py-2 rounded bg-gradient-to-r from-teal-500 to-green-500 text-black disabled:opacity-50">
                  Send
                </button>
              </div>
            </footer>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">Select a friend to start chatting.</div>
        )}
      </div>
    </div>
  );
}
