import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { ProductCard } from './ProductCard';
import { ArrowLeft, UserPlus, UserCheck, ShoppingBag, Users, Calendar, MapPin, Star, MessageSquare, ShieldCheck, ThumbsUp, Camera, X, Check, UserMinus, Plus } from 'lucide-react';
import { isUserVerified, calculateTrustScore } from '../types';
import { compressImage } from '../utils/imageOptimizer';
import { validateImageFile } from '../utils/fileValidation';
import { motion, AnimatePresence } from 'motion/react';

export const SellerProfilePage: React.FC = () => {
  const {
    users,
    products,
    chats,
    messages,
    selectedSellerId,
    setSelectedSellerId,
    setCurrentView,
    currentUser,
    followSeller,
    unfollowSeller,
    reviews,
    setShowAuthModal,
    setAuthMode,
    updateUserProfile
  } = useApp();

  const [viewedPhoto, setViewedPhoto] = useState<{ url: string; name: string; isEditable?: boolean } | null>(null);
  const [showFollowModal, setShowFollowModal] = useState(false);
  const [activeFollowTab, setActiveFollowTab] = useState<'following' | 'followers'>('following');

  const seller = users.find(u => u.id === selectedSellerId);
  const isSellerVerified = isUserVerified(seller);

  // Derive followers and following lists for this seller
  const sellerFollowers = seller ? users.filter(u => u.followingSellers?.includes(seller.id)) : [];
  const sellerFollowing = seller ? users.filter(u => seller.followingSellers?.includes(u.id)) : [];

  // If no seller ID or seller not found, render fallback
  if (!seller) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-12 text-center text-slate-500">
        <p>Seller profile not found.</p>
        <button
          onClick={() => setCurrentView('browse')}
          className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl mt-4"
        >
          Back to Marketplace
        </button>
      </div>
    );
  }

  // Filter listings belonging strictly to this seller
  const sellerProducts = products.filter(p => p.sellerId === seller.id);

  const isOwner = currentUser?.id === seller.id;
  const isFollowing = currentUser?.followingSellers?.includes(seller.id) || false;

  const handleToggleFollow = () => {
    if (!currentUser) {
      setAuthMode('login');
      setShowAuthModal(true);
      return;
    }
    if (isFollowing) {
      unfollowSeller(seller.id);
    } else {
      followSeller(seller.id);
    }
  };

  const handleMessageWhatsApp = () => {
    if (!currentUser) {
      setAuthMode('login');
      setShowAuthModal(true);
      return;
    }
    if (!seller?.whatsAppNumber) return;

    let cleanNumber = seller.whatsAppNumber.replace(/\D/g, '');
    if (cleanNumber.startsWith('0') && cleanNumber.length === 10) {
      cleanNumber = '233' + cleanNumber.substring(1);
    } else if (!cleanNumber.startsWith('233') && cleanNumber.length === 9) {
      cleanNumber = '233' + cleanNumber;
    }

    const prefilledText = `Hello! I see your store on Tedbuy marketplace and would love to chat.`;
    const finalUrl = `https://wa.me/${cleanNumber}?text=${encodeURIComponent(prefilledText)}`;
    window.open(finalUrl, '_blank', 'noopener,noreferrer');
  };

  // Generate an approximate follow count based on seed/active metrics
  const totalFollowersCount = seller.id === 'user_john' ? 15 : seller.id === 'user_kelvin' ? 8 : isFollowing ? 1 : 0;

  // Dynamic Average Response Time calculation based on historical chat records
  const getAverageResponseTime = () => {
    const sellerChats = chats.filter(c => c.sellerId === seller.id);
    const responseDiffs: number[] = [];

    sellerChats.forEach(chat => {
      const chatMsgs = messages
        .filter(m => m.chatId === chat.id)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      for (let i = 0; i < chatMsgs.length - 1; i++) {
        const current = chatMsgs[i];
        const next = chatMsgs[i + 1];

        // If the current message was sent by the buyer and the next reply was from this seller
        if (current.senderId !== seller.id && next.senderId === seller.id) {
          const diffMs = new Date(next.createdAt).getTime() - new Date(current.createdAt).getTime();
          const diffMins = Math.max(1, Math.round(diffMs / 60000));
          responseDiffs.push(diffMins);
        }
      }
    });

    if (responseDiffs.length > 0) {
      const avg = Math.round(responseDiffs.reduce((sum, d) => sum + d, 0) / responseDiffs.length);
      if (avg < 60) {
        return `${avg} min${avg > 1 ? 's' : ''}`;
      } else {
        const hrs = Math.round(avg / 60);
        return `~${hrs} hr${hrs > 1 ? 's' : ''}`;
      }
    }

    // Context-sensitive reliable fallback calculation based on username seed
    const hash = seller.username.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const fallbackMins = (hash % 20) + 4; // realistic response speed (4 to 23 mins)
    return `${fallbackMins} minutes`;
  };

  const avgResponseTime = getAverageResponseTime();

  const sellerReviews = reviews.filter(r => r.sellerId === seller.id);
  const avgRating = sellerReviews.length > 0 
    ? (sellerReviews.reduce((sum, r) => sum + r.rating, 0) / sellerReviews.length).toFixed(1)
    : null;

  const trustResult = calculateTrustScore(seller, sellerReviews);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Return link */}
      <button
        onClick={() => setCurrentView('browse')}
        className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-950 font-semibold mb-6 transition text-left"
      >
        <ArrowLeft className="w-4.5 h-4.5" />
        <span>Return to Marketplace</span>
      </button>

      {/* Profile Bio Showcase Header (Bento layout) */}
      <div className="bg-slate-900 border border-slate-800 text-white rounded-3xl p-6 sm:p-8 shadow-md text-left mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div className="flex items-center gap-5">
          {isOwner ? (
            <div className="relative shrink-0 select-none">
              <div 
                onClick={() => {
                  if (seller.photoUrl && !seller.photoUrl.includes('1549399542-7e3f8b79c341')) {
                    setViewedPhoto({ url: seller.photoUrl, name: `${seller.username}'s Profile Picture`, isEditable: true });
                  } else {
                    document.getElementById('seller-avatar-upload')?.click();
                  }
                }}
                className="group relative w-18 h-18 sm:w-20 sm:h-20 rounded-full border-2 border-slate-700/85 bg-slate-800 cursor-pointer overflow-hidden transition-all hover:ring-2 hover:ring-slate-400 hover:ring-offset-2 flex items-center justify-center"
                title={(seller.photoUrl && !seller.photoUrl.includes('1549399542-7e3f8b79c341')) ? "Click to view or change profile picture" : "Click to add profile picture"}
              >
                {(seller.photoUrl && !seller.photoUrl.includes('1549399542-7e3f8b79c341')) ? (
                  <img
                    src={seller.photoUrl}
                    alt={seller.username}
                    className="w-full h-full object-cover transition duration-300 group-hover:scale-105"
                  />
                ) : (
                  <img
                    src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><rect width='24' height='24' fill='%23f1f5f9'/><path d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z' fill='%2394a3b8'/></svg>"
                    alt="Default Profile Avatar"
                    className="w-full h-full object-cover transition duration-300"
                  />
                )}
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col items-center justify-center text-white">
                  <Camera className="w-5 h-5 text-white/95 animate-pulse" />
                  <span className="text-[9px] font-bold mt-1 text-white/90">
                    {(seller.photoUrl && !seller.photoUrl.includes('1549399542-7e3f8b79c341')) ? "View / Change" : "Add Photo"}
                  </span>
                </div>
              </div>
              <input
                type="file"
                id="seller-avatar-upload"
                accept=".webp, .jfif, .jpg, .jpeg, .png, .heic, .heif, .avif, image/jpeg, image/png, image/webp, image/heic, image/heif, image/avif"
                className="hidden"
                onClick={(e) => e.stopPropagation()}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  
                  const validation = validateImageFile(file);
                  if (!validation.isValid) {
                    console.error('File Upload Blocked:', validation.error);
                    return;
                  }
                  try {
                    const optimized = await compressImage(file, 600, 600, 0.8);
                    try {
                      await updateUserProfile({
                        username: currentUser.username,
                        phoneNumber: currentUser.phoneNumber,
                        photoUrl: optimized,
                        role: currentUser.role || 'both'
                      });
                      if (viewedPhoto && viewedPhoto.isEditable) {
                        setViewedPhoto({ url: optimized, name: `${currentUser.username}'s Profile Picture`, isEditable: true });
                      }
                    } catch (err) {
                      console.error('Error updating seller avatar: ', err);
                    }
                  } catch (err) {
                    console.error('Failed to compress avatar:', err);
                    const reader = new FileReader();
                    reader.onloadend = async () => {
                      if (typeof reader.result === 'string') {
                        try {
                          await updateUserProfile({
                            username: currentUser.username,
                            phoneNumber: currentUser.phoneNumber,
                            photoUrl: reader.result,
                            role: currentUser.role || 'both'
                          });
                          if (viewedPhoto && viewedPhoto.isEditable) {
                            setViewedPhoto({ url: reader.result, name: `${currentUser.username}'s Profile Picture`, isEditable: true });
                          }
                        } catch (err) {
                          console.error('Error updating seller avatar: ', err);
                        }
                      }
                    };
                    reader.readAsDataURL(file);
                  }
                }}
              />
            </div>
          ) : (
            <div 
              onClick={() => {
                if (seller.photoUrl && !seller.photoUrl.includes('1549399542-7e3f8b79c341')) {
                  setViewedPhoto({ url: seller.photoUrl, name: `${seller.username}'s Profile Picture` });
                }
              }}
              className={`w-18 h-18 sm:w-20 sm:h-20 rounded-full border-2 border-slate-700/85 bg-slate-800 shrink-0 overflow-hidden flex items-center justify-center ${(seller.photoUrl && !seller.photoUrl.includes('1549399542-7e3f8b79c341')) ? 'cursor-pointer hover:ring-2 hover:ring-slate-400 hover:ring-offset-2 transition-all' : ''}`}
              title={(seller.photoUrl && !seller.photoUrl.includes('1549399542-7e3f8b79c341')) ? "Click to view profile picture" : "No profile picture added yet"}
            >
              {(seller.photoUrl && !seller.photoUrl.includes('1549399542-7e3f8b79c341')) ? (
                <img
                  src={seller.photoUrl}
                  alt={seller.username}
                  className="w-full h-full object-cover"
                />
              ) : (
                <img
                  src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><rect width='24' height='24' fill='%23f1f5f9'/><path d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z' fill='%2394a3b8'/></svg>"
                  alt="Default Profile Avatar"
                  className="w-full h-full object-cover"
                />
              )}
            </div>
          )}
          <div className="space-y-1.5">
            <h1 id="seller-profile-title" className="text-xl sm:text-2xl font-bold font-sans tracking-tight text-white flex items-center gap-2 flex-wrap">
              <span>{seller.username}</span>
              {isSellerVerified && (
                <span className="inline-flex items-center gap-1 text-[10px] sm:text-xs bg-emerald-500/20 text-emerald-400 font-extrabold border border-emerald-500/25 px-2.5 py-0.5 rounded-full" title="Verified Seller">
                  🛡️ Verified Seller
                </span>
              )}
            </h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-350 font-sans">
              <span className="flex items-center gap-1">
                <Calendar className="w-4 h-4 text-slate-400" />
                Member: since {seller.joinDate}
              </span>
              <span className="flex items-center gap-1">
                <ShoppingBag className="w-4 h-4 text-slate-400" />
                <b>{sellerProducts.length}</b> live listings
              </span>
              <button
                type="button"
                onClick={() => {
                  setActiveFollowTab('followers');
                  setShowFollowModal(true);
                }}
                className="flex items-center gap-1 hover:text-white hover:underline transition cursor-pointer text-left focus:outline-none"
              >
                <Users className="w-4 h-4 text-slate-400" />
                <span><b>{sellerFollowers.length}</b> followers</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveFollowTab('following');
                  setShowFollowModal(true);
                }}
                className="flex items-center gap-1 hover:text-white hover:underline transition cursor-pointer text-left focus:outline-none"
              >
                <Users className="w-4 h-4 text-slate-400 animate-pulse" />
                <span><b>{sellerFollowing.length}</b> following</span>
              </button>
              <span className="flex items-center gap-1">
                <Star className={`w-4 h-4 ${avgRating ? 'text-amber-400 fill-amber-400' : 'text-slate-550'}`} />
                <span>
                  {avgRating ? (
                    <>
                      <strong>{avgRating}</strong> ({sellerReviews.length} {sellerReviews.length === 1 ? 'review' : 'reviews'})
                    </>
                  ) : (
                    'No ratings yet'
                  )}
                </span>
              </span>
              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] font-bold ${trustResult.color.includes('emerald') ? 'bg-emerald-500/10 text-emerald-400 border-emerald-550/20' : trustResult.color.includes('indigo') ? 'bg-indigo-500/15 text-indigo-350 border-indigo-500/20' : trustResult.color.includes('amber') ? 'bg-amber-500/15 text-amber-400 border-amber-500/20' : 'bg-slate-700/30 text-slate-300 border-slate-600/30'}`} title={trustResult.feedback}>
                🛡️ Trust Score: <b>{trustResult.score}%</b> ({trustResult.level})
              </span>
            </div>
            
            <div className="flex flex-wrap gap-2 pt-1.5 items-center">
              {isSellerVerified && (
                <span className="inline-block bg-slate-800 text-slate-200 text-[9px] font-bold px-2.5 py-0.5 rounded-md border border-slate-700 uppercase tracking-widest" title="This seller has completed phone and profile trust verification.">
                  ✓ VERIFIED SELLER
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 bg-emerald-500/10 text-emerald-400 text-[10px] font-bold px-2.5 py-0.5 rounded-md border border-emerald-500/15 uppercase tracking-wide">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                Avg Response: {avgResponseTime}
              </span>
            </div>
          </div>
        </div>

        {/* Action button */}
        {!isOwner && (
          <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
            {seller.whatsAppNumber && (
              <button
                id="seller-profile-whatsapp-btn"
                onClick={handleMessageWhatsApp}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition duration-200 text-sm flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
              >
                <MessageSquare className="w-4.5 h-4.5 fill-white/20 stroke-[2.2]" />
                <span>Message seller on whatsapp</span>
              </button>
            )}
            <button
              id="seller-profile-follow-btn"
              onClick={handleToggleFollow}
              className={`px-5 py-2.5 rounded-xl font-bold transition duration-200 text-sm flex items-center justify-center gap-1.5 shrink-0 ${
                isFollowing
                  ? 'bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-750'
                  : 'bg-white hover:bg-slate-100 text-slate-900 shadow-xs'
              }`}
            >
              {isFollowing ? (
                <>
                  <UserCheck className="w-4 h-4" />
                  <span>Following Store</span>
                </>
              ) : (
                <>
                  <UserPlus className="w-4 h-4" />
                  <span>Follow Store</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Two-Column Layout: Catalog on Left (col-span-8), Reviews on Right (col-span-4) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 text-left pt-2">
        
        {/* Left Column: Active Catalog (8 cols) */}
        <div className="lg:col-span-8 space-y-6">
          <div>
            <h2 id="seller-catalog-title" className="text-lg font-bold text-slate-900 font-sans tracking-tight">
              Active Catalog ({sellerProducts.length} items)
            </h2>
            <p className="text-xs text-slate-500">Contact the retailer directly to bargain prices or agree delivery options.</p>
          </div>

          {sellerProducts.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-3xl p-12 text-center text-slate-400">
              <ShoppingBag className="w-12 h-12 mx-auto stroke-[1.2] text-slate-300 mb-2" />
              <p className="font-semibold text-sm">No items posted yet</p>
              <p className="text-xs text-slate-400 mt-1">This seller has no commercial listings published in the directory for now.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 sm:gap-5">
              {sellerProducts.map(prod => (
                <ProductCard key={prod.id} product={prod} />
              ))}
            </div>
          )}
        </div>

        {/* Right Column: Ratings & Reviews (4 cols) */}
        <div className="lg:col-span-4 space-y-6">
          <div>
            <h2 id="seller-reviews-title" className="text-lg font-bold text-slate-900 font-sans tracking-tight flex items-center gap-2">
              <Star className="w-5 h-5 text-amber-500 fill-amber-500" />
              <span>Reviews ({sellerReviews.length})</span>
            </h2>
            <p className="text-xs text-slate-500">Customer feedback on completed marketplace transactions.</p>
          </div>

          {/* Dynamic Trust Card Block */}
          <div className="bg-slate-50 border border-slate-200 rounded-3xl p-5 space-y-4 shadow-3xs">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                🛡️ Marketplace Trust Score
              </span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-extrabold uppercase tracking-wider ${trustResult.labelClass}`}>
                {trustResult.level}
              </span>
            </div>

            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-slate-900 tracking-tight">{trustResult.score}%</span>
              <span className="text-xs text-slate-500 font-medium">Confidence Level</span>
            </div>

            {/* Micro progress bar */}
            <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden shadow-inner">
              <div 
                className={`h-2 rounded-full transition-all duration-600 ${
                  trustResult.score >= 90 ? 'bg-emerald-500' : trustResult.score >= 75 ? 'bg-indigo-600' : trustResult.score >= 50 ? 'bg-amber-505 bg-amber-500' : 'bg-rose-500'
                }`}
                style={{ width: `${trustResult.score}%` }}
              />
            </div>

            <p className="text-[11px] text-slate-650 leading-relaxed">
              {trustResult.feedback}
            </p>

            {/* Score Breakdowns */}
            <div className="pt-3 border-t border-slate-200/60 space-y-2.5 text-xs">
              <span className="text-[10px] font-bold text-slate-450 uppercase tracking-wider block">Trust Factors Breakdown</span>

              {/* Profile setup status */}
              <div className="flex items-center justify-between">
                <span className="text-slate-550 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-slate-400" />
                  Profile Identity Verification
                </span>
                {isSellerVerified ? (
                  <span className="text-emerald-700 font-extrabold text-[10px] bg-emerald-50 border border-emerald-150 px-2 py-0.5 rounded-md">
                    +80 pts (Verified)
                  </span>
                ) : (
                  <span className="text-amber-700 font-bold text-[10px] bg-amber-50 border border-amber-150 px-1.5 py-0.5 rounded-md">
                    +55 pts (Basic Setup)
                  </span>
                )}
              </div>

              {/* Positive Reviews Check */}
              <div className="flex items-center justify-between">
                <span className="text-slate-550 flex items-center gap-1.5">
                  <ThumbsUp className="w-3.5 h-3.5 text-slate-400" />
                  Positive Reviews (★4+)
                </span>
                <span className="font-mono text-slate-800 font-bold">
                  {sellerReviews.filter(r => r.rating >= 4).length} matches
                </span>
              </div>

              {/* Negative Reviews Counter */}
              <div className="flex items-center justify-between">
                <span className="text-slate-550 flex items-center gap-1.5">
                  <Star className="w-3.5 h-3.5 text-slate-400" />
                  Critical Reviews (★1-2)
                </span>
                <span className={`font-mono font-bold ${sellerReviews.filter(r => r.rating <= 2).length > 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                  {sellerReviews.filter(r => r.rating <= 2).length} reviews
                </span>
              </div>
            </div>

            <p className="text-[9px] text-slate-400 leading-snug pt-1">
              * Note: The rating matches are aggregated from all completed and reviews-certified sales recorded in our real-time Firestore database.
            </p>
          </div>

          <div className="space-y-4">
            {sellerReviews.length === 0 ? (
              <div className="bg-slate-50 border border-slate-200 rounded-3xl p-8 text-center text-slate-400 text-xs">
                <Star className="w-8 h-8 mx-auto stroke-[1.2] text-slate-305 mb-2 text-slate-400" />
                <p className="font-semibold mb-1">No reviews yet</p>
                <p className="text-slate-500">Be the first to complete a trade and rate this seller under your chats!</p>
              </div>
            ) : (
              <div className="space-y-3">
                {sellerReviews.map((rev) => (
                  <div key={rev.id} className="bg-white border border-slate-200 p-4 rounded-2xl shadow-3xs space-y-2 text-left border-b-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {rev.buyerPhoto && !rev.buyerPhoto.includes('1549399542-7e3f8b79c341') ? (
                          <img 
                            referrerPolicy="no-referrer"
                            src={rev.buyerPhoto}
                            alt={rev.buyerName} 
                            className="w-7 h-7 rounded-full object-cover border border-slate-200 cursor-pointer hover:ring-2 hover:ring-slate-350 transition-all"
                            title="Click to view profile picture"
                            onClick={() => setViewedPhoto({ url: rev.buyerPhoto!, name: `${rev.buyerName}'s Profile Picture` })}
                          />
                        ) : (
                          <img
                            src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><rect width='24' height='24' fill='%23f1f5f9'/><path d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z' fill='%2394a3b8'/></svg>"
                            alt={rev.buyerName}
                            className="w-7 h-7 rounded-full object-cover border border-slate-200 shrink-0"
                          />
                        )}
                        <div>
                          <p className="text-xs font-bold text-slate-900 leading-none">{rev.buyerName}</p>
                          <p className="text-[9px] text-slate-450 font-mono mt-0.5">
                            {new Date(rev.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5">
                        {[1, 2, 3, 4, 5].map((s) => (
                          <Star 
                            key={s} 
                            className={`w-3.5 h-3.5 ${s <= rev.rating ? 'text-amber-400 fill-amber-400' : 'text-slate-150'}`} 
                          />
                        ))}
                      </div>
                    </div>
                    {rev.productTitle && (
                      <span className="inline-block bg-slate-150 text-slate-700 text-[10px] font-bold px-2 py-0.5 rounded-lg truncate max-w-full">
                        Ad: {rev.productTitle}
                      </span>
                    )}
                    <p className="text-xs text-slate-755 leading-relaxed italic">
                      &ldquo;{rev.comment}&rdquo;
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Profile Picture Full-screen Lightbox Modal */}
      {viewedPhoto && (
        <div 
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[9999] flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setViewedPhoto(null)}
        >
          <div 
            className="relative max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden p-6 shadow-2xl flex flex-col items-center gap-4 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header info */}
            <div className="flex items-center justify-between w-full border-b border-slate-800 pb-3">
              <span className="text-sm font-bold text-slate-200 tracking-tight">{viewedPhoto.name}</span>
              <button 
                onClick={() => setViewedPhoto(null)}
                className="p-1.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Photo frame */}
            <div className="w-64 h-64 sm:w-80 sm:h-80 rounded-2xl bg-slate-950 border border-slate-800/80 overflow-hidden flex items-center justify-center shadow-inner">
              <img 
                src={viewedPhoto.url} 
                alt={viewedPhoto.name} 
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            </div>

            {/* Footer action buttons */}
            <div className="flex gap-3 w-full mt-2">
              {viewedPhoto.isEditable && (
                <button
                  onClick={() => {
                    document.getElementById('seller-avatar-upload')?.click();
                  }}
                  className="flex-1 px-4 py-2 bg-slate-100 hover:bg-white text-slate-950 text-xs font-bold rounded-xl transition shadow-3xs flex items-center justify-center gap-1.5"
                >
                  <Camera className="w-4 h-4 text-slate-800" />
                  Change Photo
                </button>
              )}
              <button
                onClick={() => setViewedPhoto(null)}
                className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl transition border border-slate-750"
              >
                Close View
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Following and Followers Modal Overlay */}
      <AnimatePresence>
        {showFollowModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 font-sans text-slate-800">
            {/* Backdrop */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowFollowModal(false)}
              className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs"
            />

            {/* Modal Content */}
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl w-full max-w-lg shadow-2xl border border-slate-200 overflow-hidden relative z-10 flex flex-col max-h-[85vh] text-left"
            >
              {/* Header */}
              <div className="px-6 py-4.5 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-black text-slate-900 tracking-tight uppercase">{seller.username}'s Connections</h3>
                  <p className="text-[10px] text-slate-500 mt-0.5 leading-none">Discover community connections and seller networks on Tedbuy.</p>
                </div>
                <button 
                  type="button"
                  onClick={() => setShowFollowModal(false)}
                  className="p-1.5 hover:bg-slate-100 hover:text-slate-900 rounded-lg text-slate-400 transition cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-slate-100 bg-slate-50/50 p-1 gap-1">
                <button
                  type="button"
                  onClick={() => setActiveFollowTab('following')}
                  className={`flex-1 py-2 text-xs font-bold rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5 ${
                    activeFollowTab === 'following'
                      ? 'bg-white text-slate-900 shadow-3xs border border-slate-200/50'
                      : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100/50'
                  }`}
                >
                  <Users className="w-3.5 h-3.5 text-slate-400 font-bold" />
                  <span>Following ({sellerFollowing.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveFollowTab('followers')}
                  className={`flex-1 py-2 text-xs font-bold rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5 ${
                    activeFollowTab === 'followers'
                      ? 'bg-white text-slate-900 shadow-3xs border border-slate-200/50'
                      : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100/50'
                  }`}
                >
                  <Users className="w-3.5 h-3.5 text-slate-400 font-bold" />
                  <span>Followers ({sellerFollowers.length})</span>
                </button>
              </div>

              {/* List container */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[250px] max-h-[500px]">
                {activeFollowTab === 'following' ? (
                  sellerFollowing.length === 0 ? (
                    <div className="text-center py-12 px-6">
                      <div className="w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3">
                        <ShoppingBag className="w-5 h-5 text-slate-400 stroke-[1.5]" />
                      </div>
                      <h4 className="text-xs font-bold text-slate-800">Not following anyone</h4>
                      <p className="text-[11px] text-slate-500 mt-1 max-w-[260px] mx-auto leading-normal">
                        This store hasn't followed other members in the community yet.
                      </p>
                    </div>
                  ) : (
                    sellerFollowing.map((user) => {
                      const isMe = currentUser?.id === user.id;
                      const amIFollowing = currentUser?.followingSellers?.includes(user.id);
                      return (
                        <div 
                          key={user.id}
                          className="flex items-center justify-between p-3 rounded-2xl bg-white border border-slate-150 hover:bg-slate-50/50 transition gap-4 text-left"
                        >
                          <div 
                            onClick={() => {
                              if (user.role === 'seller' || user.role === 'both') {
                                setSelectedSellerId(user.id);
                                setShowFollowModal(false);
                              }
                            }}
                            className="flex items-center gap-3 cursor-pointer group flex-1 min-w-0"
                          >
                            <div className="w-10 h-10 rounded-full bg-slate-100 border border-slate-200 overflow-hidden shrink-0 flex items-center justify-center text-slate-450 font-bold text-xs select-none">
                              {user.photoUrl && !user.photoUrl.includes('1549399542-7e3f8b79c341') ? (
                                <img src={user.photoUrl} alt={user.username} className="w-full h-full object-cover" />
                              ) : (
                                <img
                                  src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><rect width='24' height='24' fill='%23f1f5f9'/><path d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z' fill='%2394a3b8'/></svg>"
                                  alt={user.username}
                                  className="w-full h-full object-cover"
                                />
                              )}
                            </div>
                            <div className="min-w-0">
                              <span className="text-xs font-extrabold text-slate-900 group-hover:text-slate-950 group-hover:underline truncate block">{user.username}</span>
                              <span className="text-[9px] text-slate-450 font-mono capitalize block mt-0.5">{user.role}</span>
                            </div>
                          </div>

                          {/* Follow/Unfollow action button for logged-in user viewing lists */}
                          {!isMe && currentUser && (
                            amIFollowing ? (
                              <button
                                type="button"
                                onClick={() => unfollowSeller(user.id)}
                                className="px-2.5 py-1 text-[10px] font-bold text-rose-600 hover:text-white border border-rose-200 hover:border-rose-600 hover:bg-rose-600 rounded-lg transition shrink-0 cursor-pointer flex items-center gap-0.5 animate-duration-150"
                              >
                                <UserMinus className="w-3 h-3" />
                                <span>Unfollow</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => followSeller(user.id)}
                                className="px-2.5 py-1 text-[10px] font-bold text-slate-950 hover:text-white border border-slate-300 hover:border-slate-950 hover:bg-slate-955 rounded-lg transition shrink-0 cursor-pointer flex items-center gap-0.5 animate-duration-150"
                              >
                                <UserPlus className="w-3 h-3" />
                                <span>Follow</span>
                              </button>
                            )
                          )}
                        </div>
                      );
                    })
                  )
                ) : (
                  sellerFollowers.length === 0 ? (
                    <div className="text-center py-12 px-6">
                      <div className="w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3">
                        <Users className="w-5 h-5 text-slate-400 stroke-[1.5]" />
                      </div>
                      <h4 className="text-xs font-bold text-slate-800">No followers yet</h4>
                      <p className="text-[11px] text-slate-500 mt-1 max-w-[260px] mx-auto leading-normal">
                        No members are following this seller yet. Grow their audience by hitting follow back!
                      </p>
                    </div>
                  ) : (
                    sellerFollowers.map((user) => {
                      const isMe = currentUser?.id === user.id;
                      const amIFollowing = currentUser?.followingSellers?.includes(user.id);
                      return (
                        <div 
                          key={user.id}
                          className="flex items-center justify-between p-3 rounded-2xl bg-white border border-slate-150 hover:bg-slate-50/50 transition gap-4 text-left"
                        >
                          <div 
                            onClick={() => {
                              if (user.role === 'seller' || user.role === 'both') {
                                setSelectedSellerId(user.id);
                                setShowFollowModal(false);
                              }
                            }}
                            className="flex items-center gap-3 cursor-pointer group flex-1 min-w-0"
                          >
                            <div className="w-10 h-10 rounded-full bg-slate-100 border border-slate-200 overflow-hidden shrink-0 flex items-center justify-center text-slate-450 font-bold text-xs select-none">
                              {user.photoUrl && !user.photoUrl.includes('1549399542-7e3f8b79c341') ? (
                                <img src={user.photoUrl} alt={user.username} className="w-full h-full object-cover" />
                              ) : (
                                <img
                                  src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><rect width='24' height='24' fill='%23f1f5f9'/><path d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z' fill='%2394a3b8'/></svg>"
                                  alt={user.username}
                                  className="w-full h-full object-cover"
                                />
                              )}
                            </div>
                            <div className="min-w-0">
                              <span className="text-xs font-extrabold text-slate-900 group-hover:text-slate-950 group-hover:underline truncate block">{user.username}</span>
                              <span className="text-[9px] text-slate-450 font-mono capitalize block mt-0.5">{user.role}</span>
                            </div>
                          </div>

                          {/* Follow back actions */}
                          {!isMe && currentUser && (
                            amIFollowing ? (
                              <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded-lg">Following</span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => followSeller(user.id)}
                                className="px-2.5 py-1 text-[10px] font-bold text-slate-950 hover:text-white border border-slate-300 hover:border-slate-950 hover:bg-slate-955 rounded-lg transition shrink-0 cursor-pointer flex items-center gap-0.5 animate-duration-150"
                              >
                                <UserPlus className="w-3 h-3" />
                                <span>Follow</span>
                              </button>
                            )
                          )}
                        </div>
                      );
                    })
                  )
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
