import React, { useState } from 'react';
import { Star, X, MessageSquare, ShieldCheck } from 'lucide-react';

interface ReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  sellerId: string;
  sellerName: string;
  productTitle?: string;
  onSubmit: (rating: number, comment: string) => void;
}

export const ReviewModal: React.FC<ReviewModalProps> = ({
  isOpen,
  onClose,
  sellerId,
  sellerName,
  productTitle,
  onSubmit,
}) => {
  const [rating, setRating] = useState<number>(5);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [comment, setComment] = useState<string>('');
  const [error, setError] = useState<string>('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (rating < 1 || rating > 5) {
      setError('Please choose a rating between 1 and 5 stars.');
      return;
    }
    if (comment.trim().length < 5) {
      setError('Please write a short comment (at least 5 characters) about your experience.');
      return;
    }
    setError('');
    onSubmit(rating, comment.trim());
    setComment('');
    setRating(5);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in">
      <div 
        id="review-modal-box"
        className="bg-white border border-slate-200 rounded-3xl w-full max-w-md shadow-2xl overflow-hidden text-left transform scale-100 transition-all duration-300"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-amber-500/10 rounded-lg text-amber-600">
              <Star className="w-4 h-4 fill-amber-500" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 font-sans tracking-tight">
                Leave a Review
              </h3>
              <p className="text-[10px] text-slate-500">Rate your trading transaction</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {productTitle && (
            <div className="bg-slate-50 border border-slate-150 p-3 rounded-2xl text-xs space-y-1">
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Completed Deal</span>
              <span className="font-semibold text-slate-800 line-clamp-1">{productTitle}</span>
              <span className="text-[10px] text-slate-500 flex items-center gap-1">
                Seller: <strong className="text-slate-700">{sellerName}</strong>
              </span>
            </div>
          )}

          {/* Rating Stars Selection */}
          <div className="space-y-2 text-center py-2 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">
              How was your experience?
            </label>
            <div className="flex items-center justify-center gap-2">
              {[1, 2, 3, 4, 5].map((star) => {
                const active = hoverRating !== null ? star <= hoverRating : star <= rating;
                return (
                  <button
                    key={star}
                    type="button"
                    onClick={() => {
                      setRating(star);
                      setError('');
                    }}
                    onMouseEnter={() => setHoverRating(star)}
                    onMouseLeave={() => setHoverRating(null)}
                    className="p-1 text-slate-300 hover:text-amber-400 transition transform hover:scale-110 cursor-pointer"
                  >
                    <Star
                      className={`w-8 h-8 transition-colors ${
                        active ? 'text-amber-400 fill-amber-400' : 'text-slate-200'
                      }`}
                    />
                  </button>
                );
              })}
            </div>
            <span className="text-[11px] text-slate-650 font-semibold inline-block">
              {rating === 1 && '😠 Poor Service'}
              {rating === 2 && '😟 Below Average'}
              {rating === 3 && '😐 Okay / Standard'}
              {rating === 4 && '🙂 Good Purchase'}
              {rating === 5 && '😍 Outstanding Experience!'}
            </span>
          </div>

          {/* Review comment field */}
          <div className="space-y-1.5">
            <label htmlFor="review-comment-input" className="block text-xs font-bold text-slate-500 uppercase tracking-widest">
              Review Comment
            </label>
            <div className="relative">
              <textarea
                id="review-comment-input"
                rows={3}
                required
                maxLength={200}
                value={comment}
                onChange={(e) => {
                  setComment(e.target.value);
                  setError('');
                }}
                placeholder="Share your experience bargaining, condition of item, delivery speed..."
                className="w-full px-3 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 focus:bg-white text-slate-800 placeholder-slate-450 resize-none transition"
              />
              <span className="absolute bottom-2 right-2 text-[9px] text-slate-400 font-mono">
                {comment.length}/200
              </span>
            </div>
          </div>

          {error && (
            <p className="text-[11px] text-red-500 font-semibold bg-red-50 p-2.5 rounded-xl border border-red-100">
              ⚠️ {error}
            </p>
          )}

          {/* Secure Verified Badge footer */}
          <div className="flex items-center gap-2 text-slate-400 border-t border-slate-100 pt-4">
            <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
            <p className="text-[10px] text-slate-500 font-medium">Your comment is published instantly on the retailer profile.</p>
          </div>

          {/* Controls */}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 rounded-xl text-xs font-bold transition hover:border-slate-300 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer"
            >
              Submit Review
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
