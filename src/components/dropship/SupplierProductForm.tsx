import React, { useRef, useState } from 'react';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { GHANA_REGIONS } from '../../regions';
import type { Category } from '../../types';
import { uploadToCloudinary } from '../../utils/cloudinary';
import { validateImageFile } from '../../utils/fileValidation';
import { dropshipApi } from './dropshipApi';
import { buildProductPayload, emptyProductForm, productToForm, type ProductFormState, type SupplierProduct } from './dropshipFormat';
import { buttonClass, cardClass, inputClass, secondaryButtonClass } from './dropshipUi';

// Physical goods only: Dropship ships items from suppliers to buyers.
const PRODUCT_CATEGORIES: Category[] = [
  'Phones', 'Laptops & Computers', 'Electronics', 'Fashion', 'Home Appliances', 'Furniture & Home',
  'Beauty and Care', 'Games', 'Sports & Fitness', 'Kids & Baby', 'Commercial & Tools', 'Books & Hobbies', 'Agriculture & Food',
];
const MAX_IMAGES = 10;

export function SupplierProductForm({ initial, onSaved, onCancel }: {
  initial?: SupplierProduct;
  onSaved: (p: SupplierProduct) => void;
  onCancel: () => void;
}) {
  const { showToast } = useApp();
  const [form, setForm] = useState<ProductFormState>(() => (initial ? productToForm(initial) : emptyProductForm()));
  const [submitNow, setSubmitNow] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(crypto.randomUUID());
  const fileRef = useRef<HTMLInputElement>(null);

  const set = (k: keyof ProductFormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const addImages = async (files: FileList | null) => {
    if (!files?.length) return;
    setError('');
    setUploading(true);
    try {
      for (const file of Array.from(files).slice(0, MAX_IMAGES - form.images.length)) {
        const check = validateImageFile(file);
        if (!check.isValid) { setError(check.error || 'Invalid image.'); continue; }
        const result = await uploadToCloudinary(file, 'image');
        setForm(f => ({ ...f, images: [...f.images, result.secure_url || result.url] }));
      }
    } catch (err) {
      setError(err instanceof Error ? `Photo upload failed: ${err.message}` : 'Photo upload failed.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    let payload: Record<string, unknown>;
    try {
      payload = buildProductPayload(form, initial);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check the form.');
      return;
    }
    if (initial && Object.keys(payload).length === 0) {
      showToast('No changes to save.', 'info');
      return;
    }
    setBusy(true);
    try {
      const r = initial
        ? await dropshipApi.updateProduct(initial.id, { ...payload, expectedContentVersion: initial.contentVersion })
        : await dropshipApi.createProduct({ ...payload, clientRequestId: requestId.current, submit: submitNow });
      showToast(initial ? 'Product updated.' : submitNow ? 'Product submitted for review.' : 'Draft saved.', 'success');
      onSaved(r.product);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the product.');
    } finally {
      setBusy(false);
    }
  };

  const field = (label: string, el: React.ReactNode, wide = false) => (
    <label className={`text-[11px] font-bold text-slate-600 space-y-1 ${wide ? 'sm:col-span-2' : ''}`}>{label}{el}</label>
  );

  return (
    <form onSubmit={save} className={`${cardClass} space-y-4`}>
      <div>
        <h3 className="text-sm font-black text-slate-900">{initial ? 'Edit product' : 'New supplier product'}</h3>
        <p className="text-[11px] text-slate-500">Prices are what TedBuy pays you per unit (wholesale), in cedis. Resellers never see your contact details.</p>
      </div>

      <div>
        <p className="text-[11px] font-bold text-slate-600 mb-1">Photos ({form.images.length}/{MAX_IMAGES})</p>
        <div className="flex flex-wrap gap-2">
          {form.images.map(url => (
            <div key={url} className="relative">
              <img src={url} alt="" className="w-20 h-20 rounded-2xl object-cover border border-slate-200" />
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, images: f.images.filter(u => u !== url) }))}
                className="absolute -top-1.5 -right-1.5 p-0.5 bg-white border border-slate-200 rounded-full cursor-pointer"
                aria-label="Remove photo"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          {form.images.length < MAX_IMAGES && (
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              className="w-20 h-20 rounded-2xl border-2 border-dashed border-slate-300 flex items-center justify-center text-slate-400 hover:text-slate-600 cursor-pointer"
              aria-label="Add photos"
            >
              {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ImagePlus className="w-5 h-5" />}
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={e => addImages(e.target.files)} />
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        {field('Title', <input className={inputClass} value={form.title} onChange={set('title')} maxLength={128} />, true)}
        {field('Description', <textarea className={inputClass} rows={4} value={form.description} onChange={set('description')} maxLength={5000} />, true)}
        {field('Category', (
          <select className={inputClass} value={form.category} onChange={set('category')}>
            <option value="">Choose a category</option>
            {PRODUCT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        ))}
        {field('Condition', (
          <select className={inputClass} value={form.condition} onChange={set('condition')}>
            {['Brand New', 'Refurbished'].map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        ))}
        {field('Brand (optional)', <input className={inputClass} value={form.brand} onChange={set('brand')} maxLength={60} />)}
        {field('Wholesale price per unit (GH₵)', <input className={inputClass} value={form.wholesale} onChange={set('wholesale')} inputMode="decimal" placeholder="250.00" />)}
        {field('Suggested retail price (GH₵, optional)', <input className={inputClass} value={form.suggestedRetail} onChange={set('suggestedRetail')} inputMode="decimal" />)}
        {!initial && field('Stock on hand', <input className={inputClass} value={form.stockOnHand} onChange={set('stockOnHand')} inputMode="numeric" />)}
        {field('Maximum per order', <input className={inputClass} value={form.maxPerOrder} onChange={set('maxPerOrder')} inputMode="numeric" />)}
        {field('Ships from region', (
          <select className={inputClass} value={form.shipsFromRegion} onChange={set('shipsFromRegion')}>
            <option value="">Choose a region</option>
            {GHANA_REGIONS.map(r => <option key={r.name} value={r.name}>{r.name}</option>)}
          </select>
        ))}
        {field('Ships from city', <input className={inputClass} value={form.shipsFromCity} onChange={set('shipsFromCity')} maxLength={60} />)}
        {field('Delivery fee, same region (GH₵)', <input className={inputClass} value={form.deliverySame} onChange={set('deliverySame')} inputMode="decimal" />)}
        {field('Delivery fee, other regions (GH₵, blank if not offered)', <input className={inputClass} value={form.deliveryOther} onChange={set('deliveryOther')} inputMode="decimal" />)}
        {field('Lead time, minimum days', <input className={inputClass} value={form.leadMin} onChange={set('leadMin')} inputMode="numeric" />)}
        {field('Lead time, maximum days', <input className={inputClass} value={form.leadMax} onChange={set('leadMax')} inputMode="numeric" />)}
        {field('Return window (days)', <input className={inputClass} value={form.returnWindowDays} onChange={set('returnWindowDays')} inputMode="numeric" />)}
        {field('Return conditions (optional)', <input className={inputClass} value={form.returnConditions} onChange={set('returnConditions')} maxLength={1000} />)}
      </div>

      {!initial && (
        <label className="flex items-center gap-2 text-[11px] text-slate-600">
          <input type="checkbox" checked={submitNow} onChange={e => setSubmitNow(e.target.checked)} />
          Submit for admin review now (otherwise save as a draft)
        </label>
      )}
      {initial && <p className="text-[11px] text-slate-500">Stock is changed from the product list, not here.</p>}
      {error && <p className="text-[11px] font-bold text-rose-600">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy || uploading} className={buttonClass}>{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save</button>
        <button type="button" disabled={busy} onClick={onCancel} className={secondaryButtonClass}>Cancel</button>
      </div>
    </form>
  );
}
