import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { Chat, Message, User } from '../types';
import { Send, ShoppingBag, Eye, HelpCircle, SwitchCamera, MessageSquare, ShieldAlert } from 'lucide-react';

export const ChatInterface: React.FC = () => {
  const {
    currentUser,
    users,
    chats,
    messages,
    sendMessage,
    switchUserSimulated,
    setCurrentView,
    setSelectedProductId
  } = useApp();

  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Filter chats belonging to current user (either as buyer or seller)
  const myChats = chats.filter(c => currentUser && (c.buyerId === currentUser.id || c.sellerId === currentUser.id));

  // If no chat is active, pick the first one from the list by default
  useEffect(() => {
    if (!activeChatId && myChats.length > 0) {
      setActiveChatId(myChats[0].id);
    }
  }, [myChats, activeChatId]);

  const activeChat = chats.find(c => c.id === activeChatId);

  // Set messages as read when active chat changes
  useEffect(() => {
    if (activeChatId && currentUser) {
      // Mark all messages in this chat sent to me as read
      messages.forEach(m => {
        if (m.chatId === activeChatId && m.recipientId === currentUser.id) {
          m.read = true;
        }
      });
    }
  }, [activeChatId, messages, currentUser]);

  // Scroll to bottom of chat
  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, activeChatId]);

  if (!currentUser) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center text-slate-500">
        <p className="mb-4">You need to sign in or select a profile to view your inbox messages.</p>
        <p className="text-xs text-slate-400">Use the developer account selector bar at the top to quickly select a user.</p>
      </div>
    );
  }

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !activeChatId) return;

    sendMessage(activeChatId, inputText.trim());
    setInputText('');
  };

  // Get active chat messages
  const activeMessages = messages.filter(m => m.chatId === activeChatId);

  // Find info about the peer (other person) in active chat
  const otherUserId = activeChat ? (activeChat.buyerId === currentUser.id ? activeChat.sellerId : activeChat.buyerId) : null;
  const otherUser = users.find(u => u.id === otherUserId);
  const otherUserName = activeChat ? (activeChat.buyerId === currentUser.id ? activeChat.sellerName : activeChat.buyerName) : 'Other Party';

  const viewProductDetails = () => {
    if (activeChat) {
      setSelectedProductId(activeChat.productId);
      setCurrentView('product-detail');
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="bg-white border border-slate-200 rounded-3xl shadow-md overflow-hidden grid grid-cols-1 md:grid-cols-12 h-[calc(100vh-220px)] min-h-[500px]">
        
        {/* Left Side: Inbox List (4 cols) */}
        <div className="md:col-span-4 border-r border-slate-150 flex flex-col h-full bg-slate-50">
          <div className="p-4 border-b border-slate-150 bg-white">
            <h2 className="text-lg font-bold text-slate-900 font-sans flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-slate-900" />
              <span>Inbox History</span>
            </h2>
          </div>

          <div className="overflow-y-auto flex-1 divide-y divide-slate-100">
            {myChats.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs">
                <p className="font-semibold mb-1">No chats yet</p>
                <p>Browse products and click &ldquo;Message Seller&rdquo; to start a negotiation.</p>
              </div>
            ) : (
              myChats.map(chat => {
                const isPeerSeller = chat.buyerId === currentUser.id;
                const peerName = isPeerSeller ? chat.sellerName : chat.buyerName;
                const active = chat.id === activeChatId;

                // Count unread messages for this particular chat
                const unreadForThisChat = messages.filter(m => m.chatId === chat.id && m.recipientId === currentUser.id && !m.read).length;

                return (
                  <button
                    key={chat.id}
                    id={`chat-item-${chat.id}`}
                    onClick={() => setActiveChatId(chat.id)}
                    className={`w-full p-3.5 flex gap-3 text-left transition duration-150 group ${
                      active ? 'bg-slate-100 border-l-4 border-slate-905 font-bold' : 'bg-transparent hover:bg-slate-50'
                    }`}
                  >
                    <img
                      src={chat.productImage || 'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&w=120&q=80'}
                      alt={chat.productTitle}
                      className="w-12 h-12 rounded-xl object-cover border border-slate-150 shrink-0"
                    />
                    <div className="flex-1 min-w-0 flex flex-col justify-between">
                      <div className="flex justify-between items-baseline gap-1">
                        <span className="text-xs font-bold text-slate-900 truncate">
                          {peerName}
                        </span>
                        <span className="text-[9px] text-slate-400 font-mono shrink-0">
                          {new Date(chat.lastMessageTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 font-medium truncate font-sans">
                        Re: {chat.productTitle}
                      </p>
                      <p className="text-[11px] text-slate-450 truncate font-sans">
                        {chat.lastMessageText}
                      </p>
                    </div>
                    {unreadForThisChat > 0 && (
                      <span className="h-5 w-5 bg-red-500 text-white rounded-full text-[9px] font-bold flex items-center justify-center self-center shrink-0 animate-pulse">
                        {unreadForThisChat}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right Side: Chat Panel log (8 cols) */}
        <div className="md:col-span-8 flex flex-col h-full bg-slate-100 relative">
          {activeChat ? (
            <>
              {/* Product Info / Chat Header banner */}
              <div className="bg-white border-b border-slate-200 p-3.5 flex items-center justify-between shadow-xs sticky top-0 z-25">
                <div className="flex items-center gap-3 text-left">
                  <img
                    src={activeChat.productImage || 'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&w=120&q=80'}
                    alt={activeChat.productTitle}
                    onClick={viewProductDetails}
                    className="w-10 h-10 rounded-xl object-cover cursor-pointer hover:opacity-85 border border-slate-200"
                  />
                  <div>
                    <h3 onClick={viewProductDetails} className="text-xs font-bold text-slate-900 cursor-pointer hover:text-slate-950 transition line-clamp-1">
                      {activeChat.productTitle}
                    </h3>
                    <p className="text-sm font-bold text-slate-900 font-sans">
                      GHS {activeChat.productPrice.toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 text-xs hidden sm:inline">Negotiating with: <strong className="text-slate-700">{otherUserName}</strong></span>
                  <button
                    id="btn-chat-view-product"
                    onClick={viewProductDetails}
                    className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 font-bold text-xs text-white rounded-xl transition flex items-center gap-1"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>View Ad</span>
                  </button>
                </div>
              </div>

              {/* Chat Simulator Helper bar */}
              {otherUserId && (
                <div className="bg-slate-200/50 text-slate-800 text-[11px] font-semibold px-4 py-2 border-b border-slate-200 flex flex-wrap justify-between items-center gap-2">
                  <span className="flex items-center gap-1">
                    <HelpCircle className="w-4 h-4 text-slate-700" />
                    <span>Logged in as <b>{currentUser.username}</b>. Want to answer this negotiation?</span>
                  </span>
                  <button
                    id="simulate-reply-btn"
                    onClick={() => {
                      switchUserSimulated(otherUserId);
                    }}
                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-lg text-[10px] shadow-xs flex items-center gap-1 transition"
                  >
                    <SwitchCamera className="w-3.5 h-3.5" />
                    <span>Reply as {otherUserName.split(' ')[0]}</span>
                  </button>
                </div>
              )}

              {/* Chat messages viewport */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3.5 flex flex-col bg-slate-50/50">
                <div className="mx-auto bg-slate-150/80 text-slate-650 border border-slate-200/80 px-4 py-2 rounded-2xl text-xs font-semibold flex items-center gap-2 max-w-xs sm:max-w-md mb-4 text-left">
                  <ShieldAlert className="w-4 h-4 text-slate-800 shrink-0" />
                  <span>Classified Safety: Verify item condition in person before releasing payment.</span>
                </div>

                {activeMessages.map((msg, i) => {
                  const mine = msg.senderId === currentUser?.id;
                  const formattedTime = new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                  return (
                    <div
                      key={msg.id}
                      className={`flex ${mine ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className={`max-w-[70%] text-left ${mine ? 'order-1' : 'order-2'}`}>
                        <div
                          className={`p-3.5 rounded-2xl text-sm font-sans leading-relaxed shadow-xs ${
                            mine
                              ? 'bg-slate-900 text-white font-medium rounded-tr-none'
                              : 'bg-white text-slate-800 rounded-tl-none border border-slate-200'
                          }`}
                        >
                          {msg.text}
                        </div>
                        <div className={`text-[9px] text-slate-400 font-mono mt-1 ${mine ? 'text-right' : 'text-left'}`}>
                          {formattedTime} {mine && (msg.read ? '• Read' : '• Sent')}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={chatEndRef} />
              </div>

              {/* Message Typing Panel */}
              <form id="chat-input-form" onSubmit={handleSend} className="p-3 bg-white border-t border-slate-250 flex items-center gap-3">
                <input
                  type="text"
                  required
                  id="chat-writing-input"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder={`Write a reply to ${otherUserName}...`}
                  className="flex-1 px-4 py-2.5 bg-slate-100 hover:bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-450 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:bg-white text-sm transition"
                />
                <button
                  type="submit"
                  id="chat-send-btn"
                  className="p-3 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl transition shadow-xs flex items-center justify-center shrink-0"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 p-8">
              <ShoppingBag className="w-12 h-12 stroke-[1.5] text-slate-300 mb-2" />
              <p className="font-semibold text-sm">Please select a chat from the timeline history</p>
              <p className="text-xs text-slate-400 mt-1 max-w-sm">Here you will see all pricing negotiations, condition questions, and pickup locations.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
