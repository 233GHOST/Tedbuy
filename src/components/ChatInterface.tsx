import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { Chat, Message, User } from '../types';
import { ArrowLeft, Send, ShoppingBag, Eye, MessageSquare, ShieldAlert, Star, CheckCircle } from 'lucide-react';
import { ReviewModal } from './ReviewModal';

export const ChatInterface: React.FC = () => {
  const {
    currentUser,
    users,
    chats,
    messages,
    sendMessage,
    markChatAsRead,
    setCurrentView,
    setSelectedProductId,
    reviews,
    addReview,
    markAsDelivered,
    markAsPickedUp,
    activeChatId,
    setActiveChatId,
    viewingChatOnMobile,
    setViewingChatOnMobile
  } = useApp();

  const [inputText, setInputText] = useState('');
  const [isReviewOpen, setIsReviewOpen] = useState(false);
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
      // Fire asynchronous Firestore update with debounce/deduplication guard
      markChatAsRead(activeChatId);
    }
  }, [activeChatId, messages.length, currentUser]);

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

  // Check if currentUser already left a review for this seller on this product
  const existingReview = activeChat
    ? reviews.find(
        r =>
          r.buyerId === currentUser.id &&
          r.sellerId === activeChat.sellerId &&
          r.productTitle === activeChat.productTitle
      )
    : null;

  const viewProductDetails = () => {
    if (activeChat) {
      setSelectedProductId(activeChat.productId);
      setCurrentView('product-detail');
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-0 sm:px-6 lg:px-8 py-0 sm:py-6">
      <div className="bg-white border-0 sm:border border-slate-200 sm:rounded-3xl shadow-xs sm:shadow-md overflow-hidden flex flex-col md:grid md:grid-cols-12 h-[calc(100vh-125px)] sm:h-[calc(100vh-160px)] md:h-[calc(100vh-220px)] h-[calc(100dvh-125px)] min-h-[380px] sm:min-h-[500px] md:min-h-[550px]">
        
        {/* Left Side: Inbox List (4 cols) */}
        <div className={`${viewingChatOnMobile ? 'hidden md:flex' : 'flex'} md:col-span-4 border-r border-slate-150 flex flex-col h-full bg-slate-50`}>
          <div className="p-4 border-b border-slate-150 bg-white sticky top-0 z-10">
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
                const unreadForThisChat = chat.tradeStatus === 'completed'
                  ? 0
                  : messages.filter(m => m.chatId === chat.id && m.recipientId === currentUser.id && !m.read).length;

                return (
                  <button
                    key={chat.id}
                    id={`chat-item-${chat.id}`}
                    onClick={() => {
                      setActiveChatId(chat.id);
                      setViewingChatOnMobile(true);
                    }}
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
        <div className={`${viewingChatOnMobile ? 'flex' : 'hidden md:flex'} md:col-span-8 flex flex-col h-full bg-slate-100 relative`}>
          {activeChat ? (
            <>
              {/* Product Info / Chat Header banner */}
              <div className="bg-white border-b border-slate-200 p-3.5 flex items-center justify-between shadow-xs sticky top-0 z-25">
                <div className="flex items-center gap-2 sm:gap-3 text-left min-w-0">
                  <button
                    onClick={() => setViewingChatOnMobile(false)}
                    className="md:hidden p-1.5 rounded-xl text-slate-600 hover:bg-slate-100 active:scale-95 transition shrink-0"
                    title="Back to inbox list"
                  >
                    <ArrowLeft className="w-5 h-5 text-slate-900" />
                  </button>

                  <img
                    src={activeChat.productImage || 'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&w=120&q=80'}
                    alt={activeChat.productTitle}
                    onClick={viewProductDetails}
                    className="w-10 h-10 rounded-xl object-cover cursor-pointer hover:opacity-85 border border-slate-200 shrink-0"
                  />
                  <div className="min-w-0">
                    <h3 onClick={viewProductDetails} className="text-xs font-bold text-slate-900 cursor-pointer hover:text-slate-950 transition truncate">
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

              {/* Dynamic Transaction & Review Status Banner */}
              {activeChat && (() => {
                const currentStatus = activeChat.tradeStatus || (
                  (activeChat.deliveredBySeller && activeChat.pickedUpByBuyer) ? 'completed' : activeChat.deliveredBySeller ? 'delivered' : 'pending'
                );

                return (
                  <div className="bg-slate-900 text-white text-xs px-4 py-4 flex flex-col md:flex-row gap-4 justify-between items-stretch md:items-center border-b border-slate-950 text-left">
                    {/* Status indicator and Stepper */}
                    <div className="space-y-3 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`flex h-2.5 w-2.5 rounded-full shrink-0 ${
                          currentStatus === 'completed' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-400'
                        }`}></span>
                        <span className="font-bold text-slate-100 font-sans tracking-wide">
                          Trade Progress: 
                          {currentStatus === 'pending' && (
                            <span className="text-amber-400 ml-1.5 font-semibold">Active Negotiation (Pending Dispatch) ⏳</span>
                          )}
                          {currentStatus === 'delivered' && (
                            <span className="text-amber-300 ml-1.5 font-semibold">Seller Confirmed Delivery 📦</span>
                          )}
                          {currentStatus === 'completed' && (
                            <span className="text-emerald-400 ml-1.5 font-bold">Trade Completed Successfully! 🎉</span>
                          )}
                        </span>
                      </div>

                      {/* Explicit Interactive Stage Stepper */}
                      <div className="flex items-center gap-2 sm:gap-4 overflow-x-auto pb-1 [scrollbar-width:none]">
                        {/* Step 1: Pending */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                            currentStatus === 'pending' ? 'bg-amber-400 text-slate-950 ring-2 ring-amber-300 ring-offset-1 ring-offset-slate-900' : 'bg-emerald-500 text-white'
                          }`}>
                            {currentStatus === 'pending' ? '1' : '✓'}
                          </span>
                          <span className={`font-semibold text-[11px] ${currentStatus === 'pending' ? 'text-amber-400' : 'text-emerald-400'}`}>
                            Pending
                          </span>
                        </div>

                        <div className="h-[2px] w-6 sm:w-10 bg-slate-700 shrink-0"></div>

                        {/* Step 2: Delivered */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                            currentStatus === 'delivered' 
                              ? 'bg-amber-400 text-slate-950 ring-2 ring-amber-300 ring-offset-1 ring-offset-slate-900' 
                              : currentStatus === 'completed' 
                                ? 'bg-emerald-500 text-white' 
                                : 'bg-slate-700 text-slate-400'
                          }`}>
                            {currentStatus === 'completed' ? '✓' : '2'}
                          </span>
                          <span className={`font-semibold text-[11px] ${
                            currentStatus === 'delivered' 
                              ? 'text-amber-400' 
                              : currentStatus === 'completed' 
                                ? 'text-emerald-450 text-emerald-450' 
                                : 'text-slate-400'
                          }`}>
                            Delivered
                          </span>
                        </div>

                        <div className="h-[2px] w-6 sm:w-10 bg-slate-700 shrink-0"></div>

                        {/* Step 3: Completed */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                            currentStatus === 'completed' 
                              ? 'bg-emerald-500 text-white ring-2 ring-emerald-400 ring-offset-1 ring-offset-slate-900' 
                              : 'bg-slate-700 text-slate-400'
                          }`}>
                            3
                          </span>
                          <span className={`font-semibold text-[11px] ${currentStatus === 'completed' ? 'text-emerald-400' : 'text-slate-400'}`}>
                            Completed
                          </span>
                        </div>
                      </div>

                      {/* Explanatory subtitle */}
                      <p className="text-[11px] text-slate-300 leading-normal font-sans">
                        {/* If Current User is the Seller */}
                        {currentUser.id === activeChat.sellerId && (
                          <>
                            {currentStatus === 'pending' && "Successfully sold or dispatched? Click \"Confirm Delivered\" to unlock pickup and rating privileges for the buyer."}
                            {currentStatus === 'delivered' && `You marked this as delivered. Waiting for ${activeChat.buyerName} to inspect the item and click "Mark as Picked up".`}
                            {currentStatus === 'completed' && `Transaction complete! ${activeChat.buyerName} confirmed receipt and closed this order.`}
                          </>
                        )}
                        {/* If Current User is the Buyer */}
                        {currentUser.id === activeChat.buyerId && (
                          <>
                            {currentStatus === 'pending' && `🔒 The trade is locked. Waiting for the seller ${activeChat.sellerName} to confirm dispatch/delivery. You can confirm pickup and leave a review once they do.`}
                            {currentStatus === 'delivered' && `🎉 The seller ${activeChat.sellerName} confirmed delivery of your item! Please inspect it and click "Mark as Picked up" to rate them and finalize the trade.`}
                            {currentStatus === 'completed' && (
                              existingReview 
                                ? `Rated: You rated this transaction ${existingReview.rating} ★ ("${existingReview.comment}")`
                                : `Product received! Click Leave Review to submit your feedback for ${activeChat.sellerName}.`
                            )}
                          </>
                        )}
                      </p>
                    </div>

                    {/* Actions on the right */}
                    <div className="flex flex-col sm:flex-row md:flex-col gap-2 shrink-0 justify-end items-stretch sm:items-center md:items-end">
                      {/* Seller Actions */}
                      {currentUser.id === activeChat.sellerId && currentStatus === 'pending' && (
                        <button
                          onClick={() => markAsDelivered(activeChat.id)}
                          className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-[10px] shadow-xs transition cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap active:scale-95"
                        >
                          <CheckCircle className="w-3.5 h-3.5" />
                          <span>Confirm Delivered</span>
                        </button>
                      )}

                      {/* Buyer Actions */}
                      {currentUser.id === activeChat.buyerId && (
                        <>
                          {currentStatus !== 'completed' && (
                            currentStatus === 'delivered' ? (
                              <button
                                onClick={() => {
                                  markAsPickedUp(activeChat.id);
                                  // Auto prompt buyer to rate seller right away!
                                  setIsReviewOpen(true);
                                }}
                                className="px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-lg text-[10px] shadow-xs transition cursor-pointer flex items-center justify-center gap-1 font-bold whitespace-nowrap active:scale-95 animate-pulse"
                              >
                                <ShoppingBag className="w-3.5 h-3.5" />
                                <span>Mark as Picked up</span>
                              </button>
                            ) : (
                              <div className="flex flex-col items-stretch sm:items-end gap-1">
                                <button
                                  disabled
                                  className="px-3.5 py-2 bg-slate-800 text-slate-500 font-bold rounded-lg text-[10px] border border-slate-750 flex items-center justify-center gap-1 cursor-not-allowed whitespace-nowrap"
                                  title="Locked: Waiting for the seller to confirm delivery"
                                >
                                  <ShoppingBag className="w-3.5 h-3.5 opacity-40 animate-pulse" />
                                  <span>Mark as Picked up (Locked)</span>
                                </button>
                                <span className="text-[9px] text-slate-400 font-medium text-center sm:text-right">Awaiting seller delivery status</span>
                              </div>
                            )
                          )}

                          {currentStatus === 'completed' && !existingReview && (
                            <button
                              onClick={() => setIsReviewOpen(true)}
                              className="px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-lg text-[10px] shadow-xs transition cursor-pointer flex items-center justify-center gap-1 font-bold whitespace-nowrap active:scale-95"
                            >
                              <Star className="w-3.5 h-3.5 fill-slate-950" />
                              <span>Leave Review</span>
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Chat messages viewport */}
              <div className="flex-1 overflow-y-auto overscroll-contain p-4 space-y-3.5 flex flex-col bg-slate-50/50 [scrollbar-width:thin] [-webkit-overflow-scrolling:touch]">
                <div className="mx-auto bg-slate-150/80 text-slate-650 border border-slate-200/80 px-4 py-2 rounded-2xl text-xs font-semibold flex items-center gap-2 max-w-xs sm:max-w-md mb-4 text-left">
                  <ShieldAlert className="w-4 h-4 text-slate-800 shrink-0" />
                  <span>Classified Safety: Verify item condition in person before releasing payment.</span>
                </div>

                {activeMessages.map((msg, i) => {
                  const mine = msg.senderId === currentUser?.id;
                  const formattedTime = new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  const isSystemAlert = msg.id.startsWith('sys_') || msg.text.startsWith('📦') || msg.text.startsWith('🤝');

                  if (isSystemAlert) {
                    return (
                      <div key={msg.id} className="flex justify-center my-3 select-none">
                        <div className="bg-slate-100 text-slate-800 border border-slate-200 px-4 py-3 rounded-2xl flex items-center gap-2 max-w-sm sm:max-w-md font-sans text-xs text-left leading-relaxed shadow-3xs">
                          <span className="text-sm shrink-0">💡</span>
                          <span className="font-semibold">{msg.text}</span>
                        </div>
                      </div>
                    );
                  }

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
              <form 
                id="chat-input-form" 
                onSubmit={handleSend} 
                className="p-3 sm:p-4 bg-white border-t border-slate-200 flex items-center gap-3 sticky bottom-0 z-10 shrink-0"
                style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' }}
              >
                <input
                  type="text"
                  required
                  id="chat-writing-input"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder={`Write a reply to ${otherUserName}...`}
                  className="flex-1 px-4 py-3 bg-slate-105 bg-slate-100 hover:bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder-slate-450 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:bg-white text-base md:text-sm transition placeholder:text-slate-450"
                />
                <button
                  type="submit"
                  id="chat-send-btn"
                  className="w-12 h-12 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl transition shadow-xs flex items-center justify-center shrink-0 active:scale-95 touch-manipulation cursor-pointer"
                  title="Send message"
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
          {activeChat && (
            <ReviewModal
              isOpen={isReviewOpen}
              onClose={() => setIsReviewOpen(false)}
              sellerId={activeChat.sellerId}
              sellerName={activeChat.sellerName}
              productTitle={activeChat.productTitle}
              onSubmit={(rating, comment) => {
                addReview(activeChat.sellerId, rating, comment, activeChat.productTitle);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
};
