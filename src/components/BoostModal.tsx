import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { Product } from '../types';
import { X, Sparkles, Check, CreditCard, Phone, ShieldCheck, AlertCircle, TrendingUp, Clock, ArrowRight, Info } from 'lucide-react';
import { isBoostActive, parseDate } from '../utils/dateParser';
import { auth } from '../firebase';

interface BoostModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: Product | null;
  onSuccess?: () => void;
}

interface BoostPlan {
  id: string;
  name: string;
  priceGHS: number;
  durationDays: number;
  badge?: string;
}

const BOOST_PLANS: BoostPlan[] = [
  { id: '3days', name: '3 Days Fast Boost', priceGHS: 1, durationDays: 3 },
  { id: '7days', name: '7 Days Hot Deal Boost', priceGHS: 3, durationDays: 7, badge: 'Most Popular' },
  { id: '14days', name: '14 Days Premium Boost', priceGHS: 7, durationDays: 14 },
  { id: '30days', name: '30 Days Elite Merchant Boost', priceGHS: 12, durationDays: 30, badge: 'Best Value' },
  { id: '90days', name: '90 Days Mega Store Boost', priceGHS: 20, durationDays: 90 },
];

export const BoostModal: React.FC<BoostModalProps> = ({ isOpen, onClose, product, onSuccess }) => {
  const { currentUser, showToast, refreshProducts, updateProduct } = useApp();

  const [selectedPlanId, setSelectedPlanId] = useState<string>('7days');
  const [paymentMethod, setPaymentMethod] = useState<'momo' | 'card' | 'admin'>('momo');
  const [momoProvider, setMomoProvider] = useState<'mtn' | 'telecel' | 'airteltigo'>('mtn');
  const [phoneNumber, setPhoneNumber] = useState<string>('');
  const [cardName, setCardName] = useState<string>('');
  const [cardNumber, setCardNumber] = useState<string>('');
  const [cardExpiry, setCardExpiry] = useState<string>('');
  const [cardCvv, setCardCvv] = useState<string>('');
  
  // Checkout flow state machine
  const [checkoutStep, setCheckoutStep] = useState<'plan-select' | 'momo-push' | 'verifying' | 'success' | 'error'>('plan-select');
  const [verificationError, setVerificationError] = useState<string>('');
  const [momoSecondsLeft, setMomoSecondsLeft] = useState<number>(10);
  const [paymentReference, setPaymentReference] = useState<string>('');

  // Dynamically load Paystack script if client-side public key is present
  useEffect(() => {
    const pubKey = (import.meta as any).env?.VITE_PAYSTACK_PUBLIC_KEY;
    if (pubKey && !(window as any).PaystackPop) {
      const script = document.createElement('script');
      script.src = 'https://js.paystack.co/v1/inline.js';
      script.async = true;
      document.body.appendChild(script);
      return () => {
        const existingScript = document.querySelector('script[src="https://js.paystack.co/v1/inline.js"]');
        if (existingScript) {
          document.body.removeChild(existingScript);
        }
      };
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setCheckoutStep('plan-select');
      setSelectedPlanId('7days');
      setPaymentReference('');
      setVerificationError('');
      if (currentUser) {
        setPhoneNumber(currentUser.phoneNumber || currentUser.whatsAppNumber || '');
        setCardName(currentUser.username || '');
      }
    }
  }, [isOpen]);

  // Handle ticking MoMo simulator countdown
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (checkoutStep === 'momo-push' && momoSecondsLeft > 0) {
      timer = setTimeout(() => {
        setMomoSecondsLeft(prev => prev - 1);
      }, 1000);
    } else if (checkoutStep === 'momo-push' && momoSecondsLeft === 0) {
      // Automatically transition to verification step after push simulation
      handleVerifyPaymentBackend();
    }
    return () => clearTimeout(timer);
  }, [checkoutStep, momoSecondsLeft]);

  if (!isOpen || !product) return null;

  const activePlan = BOOST_PLANS.find(p => p.id === selectedPlanId) || BOOST_PLANS[1];

  // Helper to determine if product is currently boosted
  const isCurrentlyBoosted = isBoostActive(product);
  
  // Calculate remaining days if currently boosted
  const getRemainingDays = (): number => {
    const endDate = parseDate(product?.boostEndDate);
    if (!endDate) return 0;
    const diffMs = endDate.getTime() - Date.now();
    return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  };

  const handlePaystackCheckout = (selectedMethod: 'momo' | 'card') => {
    const publicKey = (import.meta as any).env?.VITE_PAYSTACK_PUBLIC_KEY;
    if (!publicKey) return;

    if (!(window as any).PaystackPop) {
      showToast('Paystack gateway is still loading. Please try again in 3 seconds.', 'error');
      return;
    }

    try {
      const ref = `TEDBUY_PS_${Date.now()}_${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
      setPaymentReference(ref);

      const paystack = (window as any).PaystackPop.setup({
        key: publicKey,
        email: currentUser?.email || 'asumaduvincent7@gmail.com',
        amount: activePlan.priceGHS * 100, // GHS to Pesewas
        currency: 'GHS',
        ref: ref,
        metadata: {
          custom_fields: [
            {
              display_name: "Product Title",
              variable_name: "product_title",
              value: product.title
            },
            {
              display_name: "Plan",
              variable_name: "plan_id",
              value: selectedPlanId
            }
          ]
        },
        callback: function(response: any) {
          console.log('[Paystack SuccessCallback]', response);
          const finalRef = response.reference || ref;
          setPaymentReference(finalRef);
          handleVerifyPaymentBackend(finalRef);
        },
        onClose: function() {
          showToast('Payment window closed.', 'info');
        }
      });
      paystack.openIframe();
    } catch (err: any) {
      console.error('[Paystack Setup Error]', err);
      showToast('Failed to initialize Paystack Pop-up. Please check public key format.', 'error');
    }
  };

  const handleMomoSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const activePhone = phoneNumber.trim() || currentUser?.phoneNumber || currentUser?.whatsAppNumber || '0244123456';
    setPhoneNumber(activePhone);

    const publicKey = (import.meta as any).env?.VITE_PAYSTACK_PUBLIC_KEY;
    if (publicKey) {
      handlePaystackCheckout('momo');
      return;
    }

    // Set mock reference
    setPaymentReference(`TEDBUY_DEMO_MOMO_${Date.now()}_${Math.random().toString(36).substr(2, 5).toUpperCase()}`);
    setMomoSecondsLeft(6); // 6 seconds simulation
    setCheckoutStep('momo-push');
  };

  const handleCardSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cardNumber || cardNumber.replace(/\s+/g, '').length < 16) {
      showToast('Please enter a valid 16-digit card number', 'error');
      return;
    }

    const publicKey = (import.meta as any).env?.VITE_PAYSTACK_PUBLIC_KEY;
    if (publicKey) {
      handlePaystackCheckout('card');
      return;
    }

    setPaymentReference(`TEDBUY_DEMO_CARD_${Date.now()}_${Math.random().toString(36).substr(2, 5).toUpperCase()}`);
    setCheckoutStep('verifying');
    // Start verification immediately for card
    setTimeout(() => {
      handleVerifyPaymentBackend();
    }, 1800);
  };

  const handleVerifyPaymentBackend = async (overrideRef?: any) => {
    setCheckoutStep('verifying');
    const refToVerify = (overrideRef && typeof overrideRef === 'string') ? overrideRef : (paymentReference || `TEDBUY_DEMO_BYPASS_${Date.now()}`);
    try {
      const idToken = auth.currentUser ? await auth.currentUser.getIdToken() : '';
      const headers: any = {
        'Content-Type': 'application/json'
      };
      if (idToken) {
        const cleanToken = idToken.replace(/[^A-Za-z0-9._-]/g, '');
        headers['Authorization'] = `Bearer ${cleanToken}`;
      }

      const response = await fetch('/api/verify-payment', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          paymentReference: refToVerify,
          productId: product.id,
          planId: selectedPlanId,
          paymentMethod: paymentMethod === 'momo' ? `momo_${momoProvider}` : 'card',
          email: currentUser?.email || 'asumaduvincent7@gmail.com',
          amountGHS: activePlan.priceGHS
        })
      });

      let data: any = null;
      try {
        const text = await response.text();
        try {
          data = JSON.parse(text);
        } catch (jsonErr) {
          console.error('[BoostModal] Non-JSON response received:', text);
          let cleanMessage = text;
          if (text.includes('A server error occurred') || text.includes('An error occurred')) {
            cleanMessage = 'A server error occurred during verification. Please contact support or retry.';
          } else if (text.length > 150) {
            cleanMessage = `Server error (Status: ${response.status}). The payment gateway verification returned an unexpected format.`;
          }
          throw new Error(cleanMessage);
        }
      } catch (readErr: any) {
        throw new Error(readErr.message || 'Failed to parse server response during payment verification.');
      }

      if (response.ok && data.success) {
        setCheckoutStep('success');
        showToast('Payment verified successfully! Boost activated.', 'success');
        
        // Optimistically update the product status in local memory instantly
        if (data.product) {
          try {
            await updateProduct(product.id, data.product);
            console.log('[BoostModal] Optimistically updated product local state:', data.product);
          } catch (updateErr) {
            console.warn('[BoostModal] Failed to optimistically update product state locally:', updateErr);
          }
        }

        await refreshProducts();
        if (onSuccess) onSuccess();
      } else {
        setCheckoutStep('error');
        setVerificationError(data.error || 'The payment gateway could not verify your transaction.');
      }
    } catch (err: any) {
      console.error('Verify payment error:', err);
      setCheckoutStep('error');
      setVerificationError(err.message || 'Network error occurred during payment verification.');
    }
  };

  return (
    <div id="boost-ad-modal" className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-100 flex items-center justify-center p-4 overflow-y-auto animate-fade-in">
      <div id="boost-modal-container" className="bg-white rounded-3xl max-w-lg w-full overflow-hidden shadow-2xl border border-slate-100/60 flex flex-col max-h-[90vh] animate-scale-in">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50 rounded-t-3xl text-slate-950">
          <div>
            <h2 className="text-lg font-bold text-slate-950 font-sans tracking-tight">
              {isCurrentlyBoosted ? 'Extend / Renew Boost' : 'Boost Your Listing'}
            </h2>
            <p className="text-[11px] text-slate-500 font-sans mt-0.5">Place your ad at the absolute top of the feed</p>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 hover:bg-slate-200 rounded-xl transition text-slate-500 hover:text-slate-900 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content container */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Product Quick Info Card */}
          <div className="bg-slate-50 border border-slate-200/60 rounded-2xl p-4 flex gap-3.5 items-center">
            {product.images && product.images.length > 0 ? (
              <img 
                src={product.images[0]} 
                alt={product.title} 
                className="w-14 h-14 rounded-xl object-cover border border-slate-200"
              />
            ) : (
              <div className="w-14 h-14 bg-slate-200 rounded-xl flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-slate-400" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <span className="text-xs font-bold text-slate-500 block uppercase tracking-wider">{product.category}</span>
              <h4 className="text-sm font-bold text-slate-900 truncate">{product.title}</h4>
              <p className="text-xs font-black text-slate-800 mt-0.5 font-mono">GHS {Number(product.price).toLocaleString()}</p>
            </div>
          </div>

          {/* Active boost status indicator */}
          {isCurrentlyBoosted && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <h5 className="text-xs font-black text-emerald-900 font-sans uppercase tracking-wider">Boost Active</h5>
                <p className="text-[11px] text-emerald-700 leading-relaxed mt-0.5">
                  This listing is currently boosted and expires in <strong className="font-extrabold">{getRemainingDays()} days</strong> (Ends {parseDate(product.boostEndDate)?.toLocaleDateString()}). 
                  Purchasing a new package will <strong className="font-extrabold">extend</strong> your expiration date by the package duration!
                </p>
              </div>
            </div>
          )}

          {checkoutStep === 'plan-select' && (
            <>
              {/* Step 1: Select Plan */}
              <div className="space-y-3">
                <h3 className="text-xs font-black text-slate-600 uppercase tracking-wider font-sans">1. Select Boost Duration</h3>
                <div className="space-y-2.5">
                  {BOOST_PLANS.map(plan => {
                    const isSelected = selectedPlanId === plan.id;
                    return (
                      <div 
                        key={plan.id}
                        onClick={() => setSelectedPlanId(plan.id)}
                        className={`border rounded-2xl p-4 flex items-center justify-between cursor-pointer transition-all ${
                          isSelected 
                            ? 'bg-amber-50/40 border-amber-400/80 ring-2 ring-amber-400/40 shadow-sm' 
                            : 'border-slate-200/85 hover:border-slate-350 hover:bg-slate-50/50 bg-white'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                            isSelected ? 'border-amber-500 bg-amber-500 text-white' : 'border-slate-300'
                          }`}>
                            {isSelected && <Check className="w-3.5 h-3.5 stroke-[3.5]" />}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-extrabold text-slate-900 font-sans">{plan.name}</span>
                              {plan.badge && (
                                <span className="bg-amber-100 text-amber-800 text-[8px] font-black uppercase px-2 py-0.5 rounded-full border border-amber-200/40 shadow-3xs">
                                  {plan.badge}
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-slate-500 font-sans mt-0.5 flex items-center gap-1">
                              <Clock className="w-3 h-3 text-slate-400" />
                              Promoted for {plan.durationDays} Full Days
                            </span>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="text-base font-black text-slate-900 font-mono">GH₵ {plan.priceGHS}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Step 2: Payment Method */}
              <div className="space-y-3.5 pt-1">
                <h3 className="text-xs font-black text-slate-600 uppercase tracking-wider font-sans">2. Select Payment Method</h3>
                <div className={`grid gap-3 ${currentUser?.isAdmin ? 'grid-cols-3' : 'grid-cols-2'}`}>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('momo')}
                    className={`p-3.5 border rounded-2xl flex flex-col items-center gap-2 font-semibold text-xs transition cursor-pointer ${
                      paymentMethod === 'momo'
                        ? 'border-slate-900 bg-slate-900 text-white shadow-md'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <Phone className="w-4 h-4" />
                    <span>Mobile Money (MoMo)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('card')}
                    className={`p-3.5 border rounded-2xl flex flex-col items-center gap-2 font-semibold text-xs transition cursor-pointer ${
                      paymentMethod === 'card'
                        ? 'border-slate-900 bg-slate-900 text-white shadow-md'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <CreditCard className="w-4 h-4" />
                    <span>Visa / Mastercard</span>
                  </button>
                  {currentUser?.isAdmin && (
                    <button
                      type="button"
                      onClick={() => setPaymentMethod('admin')}
                      className={`p-3.5 border rounded-2xl flex flex-col items-center gap-2 font-semibold text-xs transition cursor-pointer ${
                        paymentMethod === 'admin'
                          ? 'border-rose-900 bg-rose-900 text-white shadow-md'
                          : 'border-rose-200 bg-rose-50/50 text-rose-700 hover:bg-rose-100/50'
                      }`}
                    >
                      <Sparkles className="w-4 h-4 animate-pulse" />
                      <span>Free Admin Boost</span>
                    </button>
                  )}
                </div>

                {/* Mobile Money Input Form */}
                {paymentMethod === 'momo' && (
                  <form onSubmit={handleMomoSubmit} className="space-y-3.5 bg-slate-50 p-4 border border-slate-200/60 rounded-2xl animate-fade-in">
                    <button
                      type="submit"
                      className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-slate-950 font-extrabold text-xs tracking-wider uppercase rounded-xl transition duration-200 cursor-pointer shadow-md flex items-center justify-center gap-1.5"
                    >
                      <span>
                        Pay GH₵ {activePlan.priceGHS} via Mobile Money
                      </span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </form>
                )}

                {/* Card Input Form */}
                {paymentMethod === 'card' && (
                  <form onSubmit={handleCardSubmit} className="space-y-3.5 bg-slate-50 p-4 border border-slate-200/60 rounded-2xl animate-fade-in">
                    <div>
                      <label className="block text-[11px] font-extrabold text-slate-600 uppercase tracking-wider font-sans mb-1">Cardholder Name</label>
                      <input
                        type="text"
                        required
                        value={cardName}
                        onChange={(e) => setCardName(e.target.value)}
                        placeholder="e.g. Vincent Asumadu"
                        className="w-full px-3 py-2.5 border border-slate-250 bg-white text-slate-900 text-xs font-semibold rounded-xl outline-hidden focus:ring-2 focus:ring-slate-900 focus:border-slate-900"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-extrabold text-slate-600 uppercase tracking-wider font-sans mb-1">Card Number</label>
                      <div className="relative">
                        <CreditCard className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                        <input
                          type="text"
                          required
                          value={cardNumber}
                          onChange={(e) => {
                            const v = e.target.value.replace(/[^0-9]/g, '').substr(0, 16);
                            const formatted = v.replace(/(\{4\})/g, '$1 ').trim();
                            setCardNumber(formatted);
                          }}
                          placeholder="e.g. 4111 2222 3333 4444"
                          className="w-full pl-10 pr-4 py-2.5 border border-slate-250 bg-white text-slate-900 text-xs font-mono rounded-xl outline-hidden focus:ring-2 focus:ring-slate-900 focus:border-slate-900"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3.5">
                      <div>
                        <label className="block text-[11px] font-extrabold text-slate-600 uppercase tracking-wider font-sans mb-1">Expiry Date</label>
                        <input
                          type="text"
                          required
                          value={cardExpiry}
                          onChange={(e) => {
                            const v = e.target.value.replace(/[^0-9]/g, '').substr(0, 4);
                            if (v.length >= 2) {
                              setCardExpiry(`${v.substr(0, 2)}/${v.substr(2)}`);
                            } else {
                              setCardExpiry(v);
                            }
                          }}
                          placeholder="MM/YY"
                          className="w-full px-3 py-2.5 border border-slate-250 bg-white text-slate-900 text-xs font-mono rounded-xl outline-hidden focus:ring-2 focus:ring-slate-900 focus:border-slate-900 text-center"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-extrabold text-slate-600 uppercase tracking-wider font-sans mb-1">Security Code (CVV)</label>
                        <input
                          type="password"
                          required
                          value={cardCvv}
                          onChange={(e) => setCardCvv(e.target.value.replace(/[^0-9]/g, '').substr(0, 3))}
                          placeholder="e.g. 123"
                          className="w-full px-3 py-2.5 border border-slate-250 bg-white text-slate-900 text-xs font-mono rounded-xl outline-hidden focus:ring-2 focus:ring-slate-900 focus:border-slate-900 text-center"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs tracking-wider uppercase rounded-xl transition duration-200 cursor-pointer shadow-md flex items-center justify-center gap-1.5"
                    >
                      <span>Pay GH₵ {activePlan.priceGHS} with Card</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </form>
                )}

                {/* Free Admin Boost Form */}
                {paymentMethod === 'admin' && (
                  <div className="space-y-3.5 bg-rose-50/50 p-4 border border-rose-200/65 rounded-2xl animate-fade-in text-slate-900">
                    <p className="text-xs text-rose-800 font-sans leading-relaxed text-center px-2 py-1">
                      As an Administrator, you can activate this premium boost instantly for <strong className="font-extrabold text-rose-900">FREE</strong>. No transaction will be initiated on Paystack.
                    </p>

                    <button
                      type="button"
                      onClick={() => {
                        const ref = `ADMIN_FREE_BOOST_${Date.now()}`;
                        setPaymentReference(ref);
                        handleVerifyPaymentBackend(ref);
                      }}
                      className="w-full py-3 bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs tracking-wider uppercase rounded-xl transition duration-200 cursor-pointer shadow-md flex items-center justify-center gap-1.5"
                    >
                      <span>
                        Activate Free {activePlan.durationDays} Days Boost
                      </span>
                      <Sparkles className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Checkout Steps Overlay */}
          {checkoutStep === 'momo-push' && (
            <div className="p-6 text-center space-y-5 animate-scale-in">
              <div className="relative w-20 h-20 mx-auto">
                <div className="absolute inset-0 rounded-full bg-amber-150 animate-ping opacity-25"></div>
                <div className="absolute inset-2 rounded-full border-4 border-dashed border-amber-500 animate-spin"></div>
                <div className="absolute inset-4 rounded-full bg-amber-500 flex items-center justify-center text-white">
                  <Phone className="w-6 h-6 animate-bounce" />
                </div>
              </div>

              <div className="space-y-1.5">
                <h4 className="text-base font-black text-slate-900 font-sans">Simulated USSD MoMo Push Sent!</h4>
                <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
                  We have simulated a mobile money checkout on network phone +233 {phoneNumber}. 
                  Please enter your imaginary PIN on your virtual handset to approve the transaction.
                </p>
              </div>

              {/* Fake USSD Screen Card mockup */}
              <div className="bg-slate-900 text-white rounded-2xl p-4 shadow-lg border border-slate-800 text-left font-mono text-xs space-y-2.5 max-w-xs mx-auto">
                <div className="flex justify-between text-[10px] text-amber-400 font-bold border-b border-slate-800 pb-1.5">
                  <span>{momoProvider === 'mtn' ? 'MTN MOBILE MONEY' : momoProvider === 'telecel' ? 'TELECEL CASH' : 'AIRTELTIGO CASH'}</span>
                  <span>SIMULATOR</span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  Authorize payment of <strong className="text-amber-400">GHS {activePlan.priceGHS}.00</strong> for TedBuy Premium Boost of &ldquo;{product.title.substr(0, 18)}...&rdquo;?
                </p>
                <div className="bg-slate-950 p-2 text-slate-400 text-center rounded border border-slate-850 text-[10px] italic">
                  Pressing Confirm automatically in {momoSecondsLeft}s...
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleVerifyPaymentBackend}
                  className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl shadow-xs transition"
                >
                  I have entered my PIN / Skip Timer
                </button>
              </div>
            </div>
          )}

          {checkoutStep === 'verifying' && (
            <div className="p-6 text-center space-y-4 animate-fade-in">
              <div className="w-14 h-14 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin mx-auto"></div>
              <div>
                <h4 className="text-sm font-black text-slate-900 font-sans">Verifying Transaction Securely</h4>
                <p className="text-[11px] text-slate-450 mt-1 max-w-xs mx-auto leading-normal">
                  Connecting to payment gateway servers and verifying signature cryptographically on TedBuy backend...
                </p>
              </div>
              <div className="bg-slate-100 p-2.5 rounded-lg border border-slate-200 max-w-xs mx-auto flex items-center justify-between font-mono text-[9px] text-slate-500">
                <span>REFERENCE ID:</span>
                <span className="font-bold text-slate-700">{paymentReference || 'TEDBUY_SIMULATED_TEST'}</span>
              </div>
            </div>
          )}

          {checkoutStep === 'success' && (
            <div className="p-6 text-center space-y-5 animate-scale-in">
              <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600 mx-auto border border-emerald-200 shadow-3xs">
                <ShieldCheck className="w-8 h-8" />
              </div>
              <div className="space-y-1.5">
                <h4 className="text-lg font-black text-slate-950 font-sans">Premium Boost Activated!</h4>
                <p className="text-xs text-slate-550 max-w-sm mx-auto leading-relaxed">
                  Excellent! Your listing has been upgraded with a <strong className="font-extrabold text-slate-900">{activePlan.name}</strong> package. 
                  It will now appear at the absolute top of all classified feeds!
                </p>
              </div>

              <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl max-w-sm mx-auto text-left text-[11px] text-slate-600 space-y-2 font-sans">
                <div className="flex justify-between border-b border-slate-200/60 pb-1.5">
                  <span className="font-medium text-slate-450">Active Package:</span>
                  <strong className="font-extrabold text-slate-900">{activePlan.name} ({activePlan.durationDays} Days)</strong>
                </div>
                <div className="flex justify-between border-b border-slate-200/60 pb-1.5">
                  <span className="font-medium text-slate-450">Payment reference:</span>
                  <strong className="font-mono text-slate-900">{paymentReference}</strong>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium text-slate-450">Boost Expires:</span>
                  <strong className="font-bold text-emerald-600">
                    {isCurrentlyBoosted && parseDate(product.boostEndDate)
                      ? new Date(parseDate(product.boostEndDate)!.getTime() + (activePlan.durationDays * 24 * 60 * 60 * 1000)).toLocaleDateString()
                      : new Date(Date.now() + (activePlan.durationDays * 24 * 60 * 60 * 1000)).toLocaleDateString()
                    }
                  </strong>
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-black uppercase tracking-wider rounded-xl transition cursor-pointer shadow-sm"
                >
                  Return to Dashboard
                </button>
              </div>
            </div>
          )}

          {checkoutStep === 'error' && (
            <div className="p-6 text-center space-y-5 animate-scale-in">
              <div className="w-16 h-16 bg-rose-100 rounded-full flex items-center justify-center text-rose-600 mx-auto border border-rose-200 shadow-3xs">
                <AlertCircle className="w-8 h-8" />
              </div>
              <div className="space-y-1.5">
                <h4 className="text-base font-black text-slate-950 font-sans">Verification Failed</h4>
                <p className="text-xs text-rose-600 max-w-xs mx-auto leading-normal">
                  {verificationError}
                </p>
              </div>

              <div className="flex gap-3 justify-center pt-2">
                <button
                  type="button"
                  onClick={() => setCheckoutStep('plan-select')}
                  className="px-4 py-2 border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-bold rounded-xl transition cursor-pointer"
                >
                  Change Method / Retry
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition cursor-pointer shadow-3xs"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer info banner */}
        <div className="bg-slate-50 border-t border-slate-100 px-6 py-4.5 text-[10px] text-slate-400 flex items-center gap-2 font-sans shrink-0">
          <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span>All transactions are end-to-end encrypted under Ghana PCI compliance guidelines. TedBuy strictly registers verified payments only.</span>
        </div>
      </div>
    </div>
  );
};
