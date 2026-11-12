let cart = {};

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(', ');

const grid = document.getElementById("productGrid");
const productSearch = document.getElementById("productSearch");
const productSearchStatus = document.getElementById("productSearchStatus");
const categoryTabs = document.getElementById("categoryTabs");
const checkoutList = document.getElementById("checkoutList");
const checkoutEmpty = document.getElementById("checkoutEmpty");
const checkoutTotal = document.getElementById("checkoutTotal");
const checkoutBtn = document.getElementById("checkoutBtn");
const checkoutPanel = document.getElementById("checkoutPanel");
const closeCartBtn = document.getElementById("closeCartBtn");
const cartBar = document.getElementById("cartBar");
const cartBarCount = document.getElementById("cartBarCount");
const cartBarTotal = document.getElementById("cartBarTotal");
const cartBackdrop = document.getElementById("cartBackdrop");
// Matches the phone layout in PointofSale.css.
const sheetLayout = window.matchMedia("(max-width: 760px), (max-height: 559px)");
const variantForm = document.getElementById("variantForm");
const variantSize = document.getElementById("variantSize");
const variantColor = document.getElementById("variantColor");
const variantAvailability = document.getElementById("variantAvailability");
const addVariantBtn = document.getElementById("addVariantBtn");
const amountReceivedInput = document.getElementById("amountReceived");
const gcashRefInput = document.getElementById("gcashRefId");
const discountSection = document.getElementById("discountSection");
const discountForm = document.getElementById("discountForm");
const discountSelect = document.getElementById("discountCode");
const applyDiscountBtn = document.getElementById("applyDiscountBtn");
const discountApplied = document.getElementById("discountApplied");
const removeDiscountBtn = document.getElementById("removeDiscountBtn");
const discountMessage = document.getElementById("discountMessage");
const manualDiscountFields = document.getElementById("manualDiscountFields");
const manualPercentInput = document.getElementById("manualDiscountPercent");
const manualDiscountHint = document.getElementById("manualDiscountHint");

const formatPeso = amount => `₱${Number(amount || 0).toLocaleString("en-PH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})}`;

// Keeps Tab and Shift+Tab inside an open dialog or modal (same as layout.js).
function trapFocus(event, container) {
  const focusable = [...container.querySelectorAll(focusableSelector)]
    .filter(element => element.offsetParent !== null);
  if (!focusable.length) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!container.contains(document.activeElement)) {
    event.preventDefault();
    first.focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

// Returns focus to the element that opened a dialog, or to the product search
// when that element was re-rendered or hidden in the meantime. A button in a closed checkout
// sheet can't take focus, so the bar that opens the sheet takes it instead.
function restoreFocus(element) {
  if (sheetLayout.matches && !isCartOpen() && checkoutPanel.contains(element)) {
    cartBar.focus();
  } else if (element?.isConnected && element !== document.body && element.getClientRects().length) {
    element.focus();
  } else {
    productSearch.focus();
  }
}

// Tells screen reader users what changed in the checkout.
function announce(message) {
  const announcer = document.getElementById("posAnnouncer");
  announcer.textContent = "";
  window.setTimeout(() => { announcer.textContent = message; }, 50);
}

/* =========================
   CUSTOM DIALOG BOX (same behaviour as showDialog in layout.js)
========================= */
// Without onConfirm it is a notice with a Close button; with onConfirm it asks for confirmation.
// options: { confirmText, cancelText, danger } - danger shows a red confirm button for destructive actions.
// Focus moves into the dialog, Tab stays inside it, Escape cancels, and focus returns afterwards.
let dialogReturnFocus = null;
let dialogKeydownHandler = null;

function showDialog(title, message, onConfirm, onCancel, options = {}) {
  const existing = document.getElementById("customDialog");
  if (existing) {
    existing.remove();
    document.removeEventListener("keydown", dialogKeydownHandler, true);
  } else {
    dialogReturnFocus = document.activeElement;
  }

  const overlay = document.createElement("div");
  overlay.id = "customDialog";
  overlay.className = "dialog-overlay";

  const card = document.createElement("div");
  card.className = "dialog-card";
  card.setAttribute("role", onConfirm ? "alertdialog" : "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-labelledby", "customDialogTitle");
  card.setAttribute("aria-describedby", "customDialogMessage");

  const titleEl = document.createElement("h2");
  titleEl.id = "customDialogTitle";
  titleEl.className = "dialog-title";
  titleEl.textContent = title;

  const msgEl = document.createElement("p");
  msgEl.id = "customDialogMessage";
  msgEl.className = "dialog-message";
  msgEl.textContent = message;

  const buttons = document.createElement("div");
  buttons.className = "dialog-actions";

  const okBtn = document.createElement("button");
  okBtn.type = "button";
  okBtn.className = `btn ${options.danger ? "btn-danger" : "btn-primary"}`;
  okBtn.textContent = onConfirm ? (options.confirmText || "OK") : "Close";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn btn-secondary";
  cancelBtn.textContent = options.cancelText || "Cancel";

  function closeDialog(callback) {
    overlay.remove();
    document.removeEventListener("keydown", dialogKeydownHandler, true);
    restoreFocus(dialogReturnFocus);
    if (callback) callback();
  }

  dialogKeydownHandler = event => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeDialog(onCancel);
    } else if (event.key === "Tab") {
      trapFocus(event, card);
    }
  };

  okBtn.addEventListener("click", () => closeDialog(onConfirm));
  cancelBtn.addEventListener("click", () => closeDialog(onCancel));
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeDialog(onCancel);
  });
  document.addEventListener("keydown", dialogKeydownHandler, true);

  if (onConfirm) {
    buttons.append(cancelBtn, okBtn);
  } else {
    buttons.appendChild(okBtn);
  }

  card.append(titleEl, msgEl, buttons);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // Destructive confirmations start on Cancel so pressing Enter cannot clear or remove anything by accident.
  (onConfirm && options.danger ? cancelBtn : okBtn).focus();
}

function showToast(message, isError) {
  showDialog(isError ? "Error" : "Notice", message);
}

/* =========================
   MODALS
========================= */
// Opening a modal moves focus into it and keeps Tab inside it; Escape and the close buttons
// run the modal's close handler; closing returns focus to the button that opened it.
// The checkout flow chains modals (payment method -> cash or GCash -> receipt), so each step
// passes the opener on and closing any step returns focus to the Check Out button.
const openModals = [];
const modalCloseHandlers = {
  variantModal: () => hideModal("variantModal"),
  paymentModal: () => hideModal("paymentModal"),
  cashModal: () => { if (!salePending) hideModal("cashModal"); },
  gcashModal: () => { if (!salePending) hideModal("gcashModal"); },
  receiptModal: () => finishReceipt(false)
};

function showModal(id, returnFocus = document.activeElement) {
  const modal = document.getElementById(id);
  modal.hidden = false;
  document.body.classList.add("modal-open");
  if (!openModals.some(entry => entry.modal === modal)) {
    openModals.push({ modal, returnFocus });
  }

  const firstControl = modal.querySelector("[data-autofocus]")
    || modal.querySelector("input:not([type='hidden']), select, textarea")
    || modal.querySelector(focusableSelector);
  firstControl?.focus();
}

// Returns the element focus should go back to, so the next step of a flow can use it.
function hideModal(id, { restore = true } = {}) {
  const modal = document.getElementById(id);
  if (!modal || modal.hidden) return null;

  modal.hidden = true;
  const index = openModals.findIndex(entry => entry.modal === modal);
  if (index === -1) return null;

  const [{ returnFocus }] = openModals.splice(index, 1);
  if (!openModals.length) document.body.classList.remove("modal-open");
  if (restore) restoreFocus(returnFocus);
  return returnFocus;
}

function switchModal(fromId, toId) {
  const returnFocus = hideModal(fromId, { restore: false });
  showModal(toId, returnFocus);
}

document.addEventListener("keydown", (event) => {
  // A confirmation dialog on top of the modal handles its own keys.
  const top = openModals[openModals.length - 1];
  if (!top || document.getElementById("customDialog")) return;

  if (event.key === "Escape") {
    event.preventDefault();
    modalCloseHandlers[top.modal.id]?.();
  } else if (event.key === "Tab") {
    trapFocus(event, top.modal.querySelector(".modal-content") || top.modal);
  }
});

document.querySelectorAll(".modal [data-close-modal]").forEach(button => {
  button.addEventListener("click", () => modalCloseHandlers[button.closest(".modal").id]?.());
});

document.getElementById("variantModal").addEventListener("click", event => {
  if (event.target === event.currentTarget) hideModal("variantModal");
});

/* =========================
   PROFILE MENU & LEAVING THE POS
========================= */
const userIcon = document.getElementById("userIcon");
const profileCard = document.getElementById("profileCard");
const profileSection = document.querySelector(".profile-section");

function setProfileCardOpen(open) {
  profileCard.hidden = !open;
  userIcon.setAttribute("aria-expanded", String(open));
}

userIcon.addEventListener("click", (event) => {
  event.stopPropagation();
  setProfileCardOpen(profileCard.hidden);
});

document.addEventListener("click", (event) => {
  if (!profileSection.contains(event.target)) setProfileCardOpen(false);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !profileCard.hidden) {
    setProfileCardOpen(false);
    userIcon.focus();
  }
});

function cartHasItems() {
  return Object.keys(cart).length > 0;
}

// Closes the menu before a confirmation opens, so cancelling returns focus to the
// profile button instead of a menu item that is no longer shown.
function closeProfileMenuForDialog() {
  setProfileCardOpen(false);
  userIcon.focus();
}

// Same as logout() in layout.js; it also warns when the checkout still has items.
function logout() {
  const hasItems = cartHasItems();
  closeProfileMenuForDialog();
  showDialog(
    "Log Out",
    hasItems
      ? "Are you sure you want to log out? The items in the current checkout will be cleared."
      : "Are you sure you want to log out?",
    () => Session.signOut(),
    null,
    { confirmText: "Log Out", danger: hasItems }
  );
}

function switchToDashboard() {
  const leave = () => { window.location.href = "../page/dashboard.html"; };
  if (!cartHasItems()) {
    leave();
    return;
  }

  closeProfileMenuForDialog();
  showDialog(
    "Leave Point of Sale?",
    "The items in the current checkout will be cleared. Switch to the dashboard anyway?",
    leave,
    null,
    { confirmText: "Switch to Dashboard", danger: true }
  );
}

/* =========================
   PRODUCTS
========================= */
let productGroups = [];
let selectedVariants = [];
let selectedGroupKey = null;
let activeCategory = "All";
let shownCategories = "";
// Only the answer to the latest product request is shown, so a slow older one can't bring back old stock.
let productsRequest = 0;

// A product's sizes and colors share one card.
const groupKeyOf = product => JSON.stringify([product.product_Name, product.category]);

function groupInStock(variants) {
  return variants.some(variant => variant.stock_Quantity > 0);
}

function variantSizeOf(product) {
  return product.size?.trim() || "One Size";
}

function variantColorOf(product) {
  return product.color?.trim() || "Default";
}

function showGridMessage(text) {
  const item = document.createElement("li");
  item.className = "product-grid-empty";
  item.textContent = text;
  grid.appendChild(item);
}

// quiet: a refresh after a sale or a live update, which keeps the current products on screen if it fails.
async function loadProducts({ quiet = false } = {}) {
  const request = ++productsRequest;
  try {
    const res = await fetch("/api/POS/products");
    if (!res.ok) throw new Error(`Product request failed (${res.status})`);
    const products = await res.json();
    if (request !== productsRequest) return;

    const groups = new Map();
    products.forEach(product => {
      const groupKey = groupKeyOf(product);
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey).push(product);
    });
    // Products with stock come first and out-of-stock ones go to the bottom; each part
    // keeps the API's A–Z order.
    productGroups = [...groups.values()].sort((a, b) => groupInStock(b) - groupInStock(a));
    renderCategoryTabs();
    renderProductGrid();
    refreshVariantPicker();
    // A sale being saved takes its own stock, so the checkout is only checked once it is done.
    if (!salePending) showStockChanges(syncCartWithStock());
  } catch (err) {
    console.error("Error loading products:", err);
    if (quiet || request !== productsRequest) return;
    grid.replaceChildren();
    showGridMessage("Unable to load products. Please try again.");
    productSearchStatus.textContent = "Products could not be loaded.";
  } finally {
    UI.doneLoading(grid);
  }
}

// Keeps an open size and color picker on the latest stock.
function refreshVariantPicker() {
  if (document.getElementById("variantModal").hidden || !selectedGroupKey) return;
  selectedVariants = productGroups.find(variants => groupKeyOf(variants[0]) === selectedGroupKey) || [];
  updateVariantAvailability();
}

// Fits the checkout to the latest stock: each item's limit is updated, and an item the shop now has
// fewer of is lowered to what is left, or removed when none is left or it is no longer sold.
// Returns what was changed, as sentences for the cashier.
function syncCartWithStock() {
  const products = new Map(productGroups.flat().map(product => [product.id, product]));
  const changes = [];
  let limitsChanged = false;

  Object.values(cart).forEach(item => {
    const product = products.get(item.id);
    const stock = Math.max(0, product?.stock_Quantity ?? 0);
    if (stock !== item.stock) limitsChanged = true;
    item.stock = stock;
    if (item.qty <= stock) return;

    if (!product) {
      changes.push(`${itemLabel(item)} is no longer sold and was removed.`);
      delete cart[item.id];
    } else if (stock === 0) {
      changes.push(`${itemLabel(item)} is out of stock and was removed.`);
      delete cart[item.id];
    } else {
      changes.push(`Only ${stock} of ${itemLabel(item)} ${stock === 1 ? "is" : "are"} left, so the quantity is now ${stock}.`);
      item.qty = stock;
    }
  });

  if (changes.length || limitsChanged) {
    // The list is rebuilt, so focus goes back to the same quantity button if one had it.
    const focused = checkoutList.contains(document.activeElement) ? document.activeElement : null;
    renderCheckout(focused?.dataset.itemId ? { id: focused.dataset.itemId, action: focused.dataset.action } : null);
  }
  return changes;
}

// Tells the cashier what syncCartWithStock changed. A payment that was open shows the old total, so it
// closes and the cashier checks out again; this also drops a "Complete Sale" confirmation for the old items.
function showStockChanges(changes, { title = "Stock Changed", intro = "The stock changed since these items were added." } = {}) {
  if (!changes.length) return;
  const paymentWasOpen = closePaymentSteps();
  showDialog(title, [
    intro,
    ...changes,
    paymentWasOpen ? "Check out again to take the payment." : ""
  ].filter(Boolean).join(" "));
}

// Returns whether a payment step was open.
function closePaymentSteps() {
  return ["paymentModal", "cashModal", "gcashModal"]
    .map(id => hideModal(id) !== null)
    .some(Boolean);
}

// "All" plus one button per category the products use. The buttons are rebuilt only when
// the categories change, so a live refresh does not take focus off the button in use.
function renderCategoryTabs() {
  const categories = [...new Set(productGroups.map(variants => variants[0].category).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  if (!categories.includes(activeCategory)) activeCategory = "All";

  const key = JSON.stringify(categories);
  if (key !== shownCategories) {
    shownCategories = key;
    categoryTabs.replaceChildren(...["All", ...categories].map(category => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tab-btn";
      button.dataset.category = category;
      button.textContent = category;
      button.addEventListener("click", () => setActiveCategory(category));
      return button;
    }));
    categoryTabs.hidden = !categories.length;
  }
  markActiveCategory();
}

function markActiveCategory() {
  categoryTabs.querySelectorAll(".tab-btn").forEach(button => {
    const isActive = button.dataset.category === activeCategory;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function setActiveCategory(category) {
  activeCategory = category;
  markActiveCategory();
  renderProductGrid();
}

// Search and the category buttons filter together.
function renderProductGrid() {
  const searchTerm = productSearch.value.trim().toLowerCase();
  const isFiltered = Boolean(searchTerm) || activeCategory !== "All";
  grid.replaceChildren();

  const visibleGroups = productGroups.filter(variants =>
    (activeCategory === "All" || variants[0].category === activeCategory)
    && variants.some(product => [
      product.product_Name,
      product.category,
      product.size,
      product.color
    ].some(value => String(value || "").toLowerCase().includes(searchTerm)))
  );

  visibleGroups.forEach(variants => {
    const product = variants[0];
    const item = document.createElement("li");
    const card = document.createElement("button");
    card.type = "button";
    card.className = "product-card";
    card.setAttribute("aria-haspopup", "dialog");

    const imageWrap = document.createElement("span");
    imageWrap.className = "product-card-image";
    const placeholder = document.createElement("i");
    placeholder.className = "fa-solid fa-shirt";
    placeholder.setAttribute("aria-hidden", "true");
    imageWrap.appendChild(placeholder);
    if (product.imageUrl) {
      // The product name is right below, so the image is decorative.
      const image = document.createElement("img");
      image.alt = "";
      image.loading = "lazy";
      image.addEventListener("load", () => placeholder.remove(), { once: true });
      image.addEventListener("error", () => image.remove(), { once: true });
      image.src = product.imageUrl;
      imageWrap.appendChild(image);
    }

    const name = document.createElement("span");
    name.className = "product-card-name";
    name.textContent = product.product_Name;

    const prices = variants.map(variant => Number(variant.price));
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const price = document.createElement("span");
    price.className = "product-card-price";
    price.textContent = minPrice === maxPrice
      ? formatPeso(minPrice)
      : `${formatPeso(minPrice)} – ${formatPeso(maxPrice)}`;

    const totalStock = variants.reduce((total, variant) => total + variant.stock_Quantity, 0);
    const stock = document.createElement("span");
    stock.className = `product-card-stock${totalStock > 0 ? "" : " is-out"}`;
    stock.textContent = totalStock > 0 ? `Stock: ${totalStock}` : "Out of stock";

    const options = document.createElement("span");
    options.className = "product-card-options";
    options.textContent = `${variants.length} size/color option${variants.length === 1 ? "" : "s"}`;

    card.setAttribute("aria-label", [name.textContent, price.textContent, stock.textContent, options.textContent].join(", "));
    card.append(imageWrap, name, price, stock, options);
    card.addEventListener("click", () => openVariantPicker(variants));
    item.appendChild(card);
    grid.appendChild(item);
  });

  if (!visibleGroups.length) {
    showGridMessage(searchTerm
      ? "No products match your search."
      : activeCategory !== "All" ? `No products in ${activeCategory}.` : "No products available.");
  }

  const plural = productGroups.length === 1 ? "" : "s";
  productSearchStatus.textContent = isFiltered
    ? `Showing ${visibleGroups.length} of ${productGroups.length} product${plural}.`
    : `${productGroups.length} product${plural} available.`;
}

function openVariantPicker(variants) {
  selectedVariants = variants;
  selectedGroupKey = groupKeyOf(variants[0]);
  document.getElementById("variantProductName").textContent = variants[0].product_Name;

  const sizes = [...new Set(variants.map(variantSizeOf))];
  variantSize.replaceChildren(...sizes.map(size => new Option(size, size)));
  const firstInStock = variants.find(variant => variant.stock_Quantity > 0) || variants[0];
  variantSize.value = variantSizeOf(firstInStock);
  renderColorOptions(variantColorOf(firstInStock));
  showModal("variantModal");
}

function selectedProductVariant() {
  return selectedVariants.find(variant =>
    variantSizeOf(variant) === variantSize.value
    && variantColorOf(variant) === variantColor.value
  );
}

function renderColorOptions(preferredColor) {
  const matchingVariants = selectedVariants.filter(variant => variantSizeOf(variant) === variantSize.value);
  const colors = [...new Set(matchingVariants.map(variantColorOf))];
  variantColor.replaceChildren(...colors.map(color => new Option(color, color)));
  variantColor.value = colors.includes(preferredColor) ? preferredColor : colors[0];
  updateVariantAvailability();
}

function updateVariantAvailability() {
  const product = selectedProductVariant();
  addVariantBtn.disabled = !product || product.stock_Quantity <= 0;
  variantAvailability.textContent = product
    ? product.stock_Quantity > 0
      ? `Available stock: ${product.stock_Quantity} · ${formatPeso(product.price)}`
      : "This size and color are out of stock."
    : "This size and color combination is unavailable.";
}

productSearch.addEventListener("input", renderProductGrid);
variantSize.addEventListener("change", () => renderColorOptions());
variantColor.addEventListener("change", updateVariantAvailability);
variantForm.addEventListener("submit", event => {
  event.preventDefault();
  const product = selectedProductVariant();
  if (!product || product.stock_Quantity <= 0) return;
  hideModal("variantModal");
  addToCart(product);
});

/* =========================
   CHECKOUT
========================= */
// The applied discount, or null: { name, code, description, type, value, minPurchase, label } for a
// coupon, or the same with manual: true and code: null for a manual discount.
let appliedDiscount = null;

const toCents = amount => Math.round(Number(amount || 0) * 100);

function cartSubtotal() {
  return Object.values(cart).reduce((sum, item) => sum + item.price * item.qty, 0);
}

// The same rule as StoredDiscount.AmountOff and ManualDiscount.AmountOff on the server, worked out in
// centavos so both round alike: a whole-number percentage of the subtotal, or a fixed amount that
// never exceeds it. Nothing comes off while the subtotal is below the coupon's minimum purchase
// (a manual discount has none).
function discountAmount() {
  if (!appliedDiscount) return 0;
  const subtotalCents = toCents(cartSubtotal());
  if (subtotalCents < toCents(appliedDiscount.minPurchase)) return 0;
  const cents = appliedDiscount.type === "percent"
    ? Math.round(subtotalCents * appliedDiscount.value / 100)
    : Math.min(toCents(appliedDiscount.value), subtotalCents);
  return cents / 100;
}

// What the customer pays: the subtotal less any discount.
function cartTotal() {
  return (toCents(cartSubtotal()) - toCents(discountAmount())) / 100;
}

function cartItemsPayload() {
  return Object.values(cart).map(item => ({ productId: item.id, quantity: item.qty }));
}

function itemLabel(item) {
  return `${item.name} (${item.size} / ${item.color})`;
}

function addToCart(product) {
  const id = product.id || product.product_Id;

  if (product.stock_Quantity <= 0) {
    showToast("Out of stock!", true);
    return;
  }

  if (cart[id]) {
    cart[id].stock = product.stock_Quantity;
    if (cart[id].qty < product.stock_Quantity) {
      cart[id].qty++;
    } else {
      showToast("No more stock available for " + product.product_Name, true);
      return;
    }
  } else {
    cart[id] = {
      id: id,
      name: product.product_Name,
      size: variantSizeOf(product),
      color: variantColorOf(product),
      price: product.price,
      qty: 1,
      stock: product.stock_Quantity
    };
  }

  renderCheckout();
  announce(`Added ${itemLabel(cart[id])}. Quantity ${cart[id].qty}. Total ${formatPeso(cartTotal())}.`);
}

function changeCartQuantity(id, change) {
  const item = cart[id];
  if (!item) return;

  const newQuantity = item.qty + change;
  if (newQuantity > item.stock) {
    showToast("No more stock available for " + item.name, true);
    return;
  }

  if (newQuantity <= 0) {
    confirmRemoveItem(id);
    return;
  }

  item.qty = newQuantity;
  renderCheckout({ id, action: change > 0 ? "increase" : "decrease" });
  announce(`${itemLabel(item)} quantity ${item.qty}. Total ${formatPeso(cartTotal())}.`);
}

function confirmRemoveItem(id) {
  const item = cart[id];
  showDialog(
    "Remove Item",
    `Remove ${itemLabel(item)} from the checkout?`,
    () => {
      const ids = Object.keys(cart);
      const nextId = ids[ids.indexOf(String(id)) + 1] || ids[ids.indexOf(String(id)) - 1];
      delete cart[id];
      // Focus moves to the next item's quantity controls, or back to the search when the checkout is empty.
      renderCheckout(nextId ? { id: nextId, action: "decrease" } : null);
      if (!nextId) productSearch.focus();
      announce(`Removed ${itemLabel(item)}. Total ${formatPeso(cartTotal())}.`);
    },
    null,
    { confirmText: "Remove", danger: true }
  );
}

function quantityButton(item, action) {
  const isDecrease = action === "decrease";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-secondary btn-icon";
  button.dataset.itemId = item.id;
  button.dataset.action = action;

  const icon = document.createElement("i");
  icon.className = `fa-solid ${isDecrease ? (item.qty === 1 ? "fa-trash-can" : "fa-minus") : "fa-plus"}`;
  icon.setAttribute("aria-hidden", "true");
  button.appendChild(icon);

  button.setAttribute("aria-label", isDecrease
    ? item.qty === 1 ? `Remove ${itemLabel(item)} from checkout` : `Decrease ${itemLabel(item)} quantity`
    : `Increase ${itemLabel(item)} quantity`);
  // aria-disabled keeps the button focusable at the stock limit; pressing it explains why.
  if (!isDecrease && item.qty >= item.stock) button.setAttribute("aria-disabled", "true");
  button.addEventListener("click", () => changeCartQuantity(item.id, isDecrease ? -1 : 1));
  return button;
}

// focusTarget: { id, action } - the quantity button to focus after the list is rebuilt.
function renderCheckout(focusTarget = null) {
  checkoutList.replaceChildren();

  Object.values(cart).forEach(item => {
    const li = document.createElement("li");
    li.className = "checkout-item";

    const details = document.createElement("div");
    details.className = "checkout-item-details";
    const name = document.createElement("span");
    name.className = "checkout-item-name";
    name.textContent = item.name;
    const variant = document.createElement("span");
    variant.className = "checkout-item-variant";
    variant.textContent = `${item.size} / ${item.color}`;
    const itemSubtotal = document.createElement("span");
    itemSubtotal.className = "checkout-item-subtotal";
    itemSubtotal.textContent = `${item.qty} × ${formatPeso(item.price)} = ${formatPeso(item.qty * item.price)}`;
    details.append(name, variant, itemSubtotal);

    const quantityControls = document.createElement("div");
    quantityControls.className = "quantity-controls";
    quantityControls.setAttribute("role", "group");
    quantityControls.setAttribute("aria-label", `Quantity of ${itemLabel(item)}`);

    const quantity = document.createElement("span");
    quantity.className = "quantity-value";
    quantity.textContent = item.qty;

    quantityControls.append(quantityButton(item, "decrease"), quantity, quantityButton(item, "increase"));
    li.append(details, quantityControls);
    checkoutList.appendChild(li);
  });

  checkoutEmpty.hidden = cartHasItems();
  // A coupon belongs to one sale, so an empty checkout (sale saved, cancelled or every item removed) drops it.
  if (!cartHasItems()) resetDiscount();
  renderDiscount();
  checkoutTotal.textContent = formatPeso(cartTotal());

  const itemCount = Object.values(cart).reduce((sum, item) => sum + item.qty, 0);
  cartBarCount.textContent = `${itemCount} item${itemCount === 1 ? "" : "s"}`;
  cartBarTotal.textContent = checkoutTotal.textContent;
  // An empty checkout has nothing to show; the receipt modal keeps focus if a sale just ended.
  if (!itemCount && isCartOpen()) setCartOpen(false, { restore: !openModals.length });

  if (focusTarget) {
    checkoutList.querySelector(
      `[data-item-id="${CSS.escape(String(focusTarget.id))}"][data-action="${focusTarget.action}"]`
    )?.focus();
  }
}

function clearCheckout() {
  cart = {};
  renderCheckout();
}

/* =========================
   DISCOUNT
========================= */
// The cashier picks one of today's coupons from the dropdown, or "Manual discount" to type a
// percentage. The server checks the choice when it is applied, again just before stock is taken,
// and once more when the sale is saved, where it works out the discount and the total itself.
let discountPending = false;

// The dropdown's value for a manual discount. Coupon codes are saved in capitals, so none can match it.
const MANUAL_OPTION = "manual";
// The most the signed-in person can take off with a manual discount, or 0 when they can't. The
// server works it out from their role: owners up to 100%, staff up to the owner's limit.
let manualMaxPercent = 0;

const isManualChoice = () => discountSelect.value === MANUAL_OPTION;

function setDiscountMessage(text, isError = false) {
  discountMessage.textContent = text;
  discountMessage.classList.toggle("is-error", isError && Boolean(text));
}

function clearDiscountErrors() {
  discountForm.querySelectorAll("[aria-invalid]").forEach(field => field.removeAttribute("aria-invalid"));
}

function resetDiscount() {
  appliedDiscount = null;
  discountSelect.value = "";
  manualPercentInput.value = "";
  clearDiscountErrors();
  updateManualFields();
  setDiscountMessage("");
}

// "SALE10 · 10% off · min ₱500.00"
function discountOptionText(discount) {
  const minimum = Number(discount.minPurchase) > 0 ? ` · min ${formatPeso(discount.minPurchase)}` : "";
  return `${discount.code} · ${discount.label}${minimum}`;
}

// The percent field shows while "Manual discount" is chosen.
function updateManualFields() {
  manualDiscountFields.hidden = !isManualChoice();
  manualDiscountHint.textContent = `A whole number from 1 to ${manualMaxPercent}.`;
}

// Fills the dropdown with the coupons that can be used today, then "Manual discount" when the
// cashier may give one, keeping the current choice if it is still there.
async function loadAvailableDiscounts() {
  const [coupons, manual] = await Promise.allSettled([
    UI.fetchJson("/api/Discounts/available"),
    UI.fetchJson("/api/Discounts/manual")
  ]);
  if (coupons.status === "rejected") console.error("Discount List Error:", coupons.reason);
  if (manual.status === "rejected") console.error("Manual Discount Error:", manual.reason);
  manualMaxPercent = manual.status === "fulfilled" ? Number(manual.value.maxPercent) || 0 : 0;

  const options = (coupons.status === "fulfilled" ? coupons.value : [])
    .map(discount => new Option(discountOptionText(discount), discount.code));
  if (manualMaxPercent > 0) {
    const limit = manualMaxPercent < 100 ? ` · up to ${manualMaxPercent}%` : "";
    options.push(new Option(`Manual discount${limit}`, MANUAL_OPTION));
  }
  const placeholder = coupons.status === "rejected" ? "Coupons could not be loaded"
    : options.length ? "Choose a discount"
    : "No discounts available today";

  const chosen = discountSelect.value;
  discountSelect.replaceChildren(new Option(placeholder, ""), ...options);
  discountSelect.value = options.some(option => option.value === chosen) ? chosen : "";
  updateManualFields();
}

// Shows the dropdown or the applied discount, and the subtotal and discount lines when it takes something off.
function renderDiscount() {
  const amount = discountAmount();
  // A new checkout gets a fresh list, so coupons made or turned off since the last sale show correctly.
  if (cartHasItems() && discountSection.hidden) loadAvailableDiscounts();
  discountSection.hidden = !cartHasItems();
  discountForm.hidden = Boolean(appliedDiscount);
  discountApplied.hidden = !appliedDiscount;

  if (appliedDiscount) {
    document.getElementById("discountAppliedCode").textContent = appliedDiscount.name;
    document.getElementById("discountAppliedLabel").textContent = appliedDiscount.label;
    const shortBy = (toCents(appliedDiscount.minPurchase) - toCents(cartSubtotal())) / 100;
    setDiscountMessage(shortBy > 0
      ? `Add ${formatPeso(shortBy)} more to use this code (minimum purchase ${formatPeso(appliedDiscount.minPurchase)}).`
      : appliedDiscount.description);
  }

  document.getElementById("subtotalLine").hidden = !amount;
  document.getElementById("discountLine").hidden = !amount;
  document.getElementById("checkoutSubtotal").textContent = formatPeso(cartSubtotal());
  document.getElementById("discountLineLabel").textContent = `Discount (${appliedDiscount?.name || ""})`;
  document.getElementById("checkoutDiscount").textContent = `−${formatPeso(amount)}`;
}

function checkDiscount(code) {
  return UI.fetchJson("/api/Discounts/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, items: cartItemsPayload() })
  });
}

function checkManualDiscount(percent) {
  return UI.fetchJson("/api/Discounts/apply-manual", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ percent, items: cartItemsPayload() })
  });
}

// Marks the field that needs fixing and says why.
function showDiscountProblem(field, message) {
  field.setAttribute("aria-invalid", "true");
  setDiscountMessage(message, true);
  field.focus();
  announce(message);
}

// Returns the percent off, or null after pointing at the field. The server checks the same rule
// (ManualDiscount.Problem).
function readManualPercent() {
  const percent = Number(manualPercentInput.value);
  if (!manualPercentInput.value || !Number.isInteger(percent) || percent < 1 || percent > manualMaxPercent) {
    showDiscountProblem(manualPercentInput, `Enter the percent off, from 1 to ${manualMaxPercent}.`);
    return null;
  }
  return percent;
}

// appliedDiscount from what /api/Discounts/apply and /apply-manual send back.
const couponFrom = result => ({
  name: result.code,
  code: result.code,
  description: result.description,
  type: result.type,
  value: Number(result.value),
  minPurchase: Number(result.minPurchase),
  label: result.label
});

const manualDiscountFrom = result => ({
  manual: true,
  name: "Manual",
  code: null,
  description: "",
  type: "percent",
  value: Number(result.percent),
  minPurchase: 0,
  label: result.label
});

async function applyDiscount(event) {
  event.preventDefault();
  if (discountPending) return;
  clearDiscountErrors();

  const choice = discountSelect.value;
  if (!choice) {
    showDiscountProblem(discountSelect,
      discountSelect.options.length > 1 ? "Choose a discount first." : "There are no discounts to apply today.");
    return;
  }
  const manual = choice === MANUAL_OPTION;
  const percent = manual ? readManualPercent() : null;
  if (manual && percent === null) return;

  discountPending = true;
  const restore = UI.setLoading(applyDiscountBtn, "Checking...");
  try {
    appliedDiscount = manual
      ? manualDiscountFrom(await checkManualDiscount(percent))
      : couponFrom(await checkDiscount(choice));
    renderCheckout();
    // The dropdown is hidden now, so focus moves to the applied discount's remove button.
    removeDiscountBtn.focus();
    announce(`Discount ${appliedDiscount.name} applied, ${appliedDiscount.label}. Total ${formatPeso(cartTotal())}.`);
  } catch (error) {
    console.error("Discount Error:", error);
    showDiscountProblem(manual ? manualPercentInput : discountSelect,
      error.status ? error.message : "Cannot connect to the server. Please try again.");
    // The coupon may have been turned off or used up, or the manual limit changed, so the list is refreshed.
    if (error.status) loadAvailableDiscounts();
  } finally {
    restore();
    discountPending = false;
  }
}

function removeDiscount() {
  const name = appliedDiscount?.name;
  resetDiscount();
  renderCheckout();
  discountSelect.focus();
  announce(`Discount ${name} removed. Total ${formatPeso(cartTotal())}.`);
}

discountForm.addEventListener("submit", applyDiscount);
removeDiscountBtn.addEventListener("click", removeDiscount);
discountSelect.addEventListener("change", () => {
  clearDiscountErrors();
  setDiscountMessage("");
  updateManualFields();
});
// The percent is a whole number, so anything but digits is dropped.
manualPercentInput.addEventListener("input", () => {
  manualPercentInput.value = manualPercentInput.value.replace(/\D/g, "").slice(0, 3);
  manualPercentInput.removeAttribute("aria-invalid");
  setDiscountMessage("");
});

/* =========================
   CART SHEET (phones and short windows)
========================= */
// PointofSale.css keeps the checkout off screen on these screens and shows a bar with the
// item count and total. The bar slides the checkout up over the page as a sheet.
const isCartOpen = () => document.body.classList.contains("cart-open");

function setCartOpen(open, { restore = true } = {}) {
  document.body.classList.toggle("cart-open", open);
  cartBar.setAttribute("aria-expanded", String(open));
  if (open) closeCartBtn.focus();
  else if (restore) cartBar.focus();
}

cartBar.addEventListener("click", () => setCartOpen(true));
closeCartBtn.addEventListener("click", () => setCartOpen(false));
cartBackdrop.addEventListener("click", () => setCartOpen(false));

document.addEventListener("keydown", (event) => {
  if (!isCartOpen() || openModals.length || document.getElementById("customDialog")) return;

  if (event.key === "Escape") {
    event.preventDefault();
    setCartOpen(false);
  } else if (event.key === "Tab") {
    trapFocus(event, checkoutPanel);
  }
});

// Turning a phone or widening the window brings the checkout back beside the products.
sheetLayout.addEventListener("change", event => {
  if (!event.matches && isCartOpen()) setCartOpen(false, { restore: false });
});

function confirmCancelCheckout() {
  if (!cartHasItems()) {
    showDialog("Notice", "The checkout is already empty.");
    return;
  }

  showDialog(
    "Cancel Checkout",
    "Are you sure you want to cancel? All items will be removed from the checkout.",
    () => {
      clearCheckout();
      announce("Checkout cancelled. All items were removed.");
    },
    null,
    { confirmText: "Yes, Cancel", cancelText: "Keep Checkout", danger: true }
  );
}

/* =========================
   PAYMENT
========================= */
let salePending = false;
let receiptTx = null;

function generateReferenceId() {
  return 'REF-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
}

// subtotal_amount, discount_amount, discountName and discountLabel are for the receipt; the server
// works out the discounted total itself from discountCode (a coupon) or manualDiscountPercent
// (a manual discount), which are only sent when the discount takes something off.
function buildTransaction(method, received = null, change = null, refId = null) {
  const discount = discountAmount();
  const applied = discount > 0 ? appliedDiscount : null;
  return {
    referenceId: refId || generateReferenceId(),
    date_time: new Date().toISOString(),
    subtotal_amount: cartSubtotal(),
    discount_amount: discount,
    discountCode: applied && !applied.manual ? applied.code : null,
    manualDiscountPercent: applied?.manual ? applied.value : null,
    discountName: applied?.name ?? null,
    discountLabel: applied?.label ?? null,
    total_amount: cartTotal(),
    status: "Completed",
    assistedBy: localStorage.getItem("userName")?.trim() || "Unknown",
    items: Object.values(cart).map(item => ({
      productId: item.id,
      name: item.name,
      size: item.size,
      color: item.color,
      quantity: item.qty,
      price: item.price
    })),
    payment_method: method,
    amount_received: received,
    change_given: change
  };
}

// Saves the sale with one request: the server takes the stock and saves the sale together
// (TransactionController.SaveTransaction), so a sale that fails changes nothing and can be tried again.
// Returns { saved: true }, { saved: false } after showing the error, { discountProblem } when the
// discount can no longer be used, or { stockProblem: true } when the shop no longer has enough of an
// item (another till sold it, or it was edited or archived).
async function processCheckout(tx) {
  try {
    // The code may have been turned off, used up or expired since it was applied, or the owner may
    // have lowered the manual discount limit. This gives a clear answer before the sale is sent;
    // the server checks once more while saving it.
    if (tx.discountCode || tx.manualDiscountPercent) {
      try {
        if (tx.discountCode) await checkDiscount(tx.discountCode);
        else await checkManualDiscount(tx.manualDiscountPercent);
      } catch (error) {
        if (error.status >= 400 && error.status < 500) return { saved: false, discountProblem: error.message };
        throw error;
      }
    }

    const transactionRes = await fetch("/api/POS/Transaction", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tx)
    });

    // The reasons are SaleConflicts on the server.
    if (transactionRes.status === 409) {
      const conflict = await transactionRes.json().catch(() => ({}));
      if (conflict.reason === "stock") return { saved: false, stockProblem: true };
      if (conflict.reason === "discount") {
        return { saved: false, discountProblem: conflict.message || "This discount can no longer be used." };
      }
    }
    if (!transactionRes.ok) throw new Error(`Transaction could not be saved (${transactionRes.status})`);

    console.log("Sale saved.");
    return { saved: true };
  } catch (err) {
    console.error("Error during checkout:", err);
    showToast("Checkout failed. Please try again.", true);
    return { saved: false };
  }
}

// Saves the sale once the cashier confirms it. While it is saving, the payment
// form cannot be sent again or closed. The checkout is cleared as soon as the
// sale is saved, so closing the receipt prompt can never charge the same items twice.
async function completeSale(tx, modalId, submitButton) {
  if (salePending) return;
  salePending = true;
  const buttonText = submitButton.textContent;
  submitButton.setAttribute("aria-disabled", "true");
  submitButton.textContent = "Saving...";

  const { saved, discountProblem, stockProblem } = await processCheckout(tx);
  // Still pending, so this refresh leaves the checkout alone until it is checked below.
  if (stockProblem) await loadProducts({ quiet: true });

  salePending = false;
  submitButton.removeAttribute("aria-disabled");
  submitButton.textContent = buttonText;

  if (stockProblem) {
    const changes = syncCartWithStock();
    if (changes.length) {
      showStockChanges(changes, { title: "Not Enough Stock", intro: "Nothing was sold, because the stock changed." });
    } else {
      closePaymentSteps();
      showDialog(
        "Not Enough Stock",
        "Nothing was sold, because a product no longer has enough stock. The products were refreshed; check the checkout and try again."
      );
    }
    return;
  }

  // The total changes without the discount, so the payment starts again from Check Out.
  if (discountProblem) {
    hideModal(modalId);
    resetDiscount();
    renderCheckout();
    loadAvailableDiscounts();
    showDialog(
      "Discount Removed",
      `${discountProblem} It was taken off this checkout, so the total is now ${formatPeso(cartTotal())}. Check out again to take the payment.`
    );
    return;
  }
  if (!saved) return;

  const returnFocus = hideModal(modalId, { restore: false });
  clearCheckout();
  receiptTx = tx;
  showModal("receiptModal", returnFocus);
  announce("Payment complete. The sale was saved.");
  // Shows the stock this sale left right away, without waiting for (or depending on) the live update.
  loadProducts({ quiet: true });
}

checkoutBtn.addEventListener("click", () => {
  if (!cartHasItems()) {
    showDialog("Notice", "The checkout is empty. Add a product first.");
    return;
  }
  document.getElementById("modalTotal").textContent = formatPeso(cartTotal());
  showModal("paymentModal");
});

document.getElementById("cashBtn").addEventListener("click", () => {
  document.getElementById("cashTotal").textContent = formatPeso(cartTotal());
  amountReceivedInput.value = "";
  amountReceivedInput.removeAttribute("aria-invalid");
  updateChange();
  switchModal("paymentModal", "cashModal");
});

document.getElementById("gcashBtn").addEventListener("click", () => {
  document.getElementById("gcashTotal").textContent = formatPeso(cartTotal());
  gcashRefInput.value = "";
  gcashRefInput.removeAttribute("aria-invalid");
  switchModal("paymentModal", "gcashModal");
});

function updateChange() {
  const received = parseFloat(amountReceivedInput.value);
  const total = cartTotal();
  const changeLine = document.getElementById("changeLine");
  const isShort = !isNaN(received) && received < total;

  changeLine.classList.toggle("is-short", isShort);
  document.getElementById("changeLabel").textContent = isShort ? "Still due:" : "Change:";
  document.getElementById("changeDisplay").textContent = isNaN(received)
    ? formatPeso(0)
    : formatPeso(Math.abs(received - total));
}

amountReceivedInput.addEventListener("input", () => {
  const parts = amountReceivedInput.value.replace(/[^\d.]/g, '').split('.');
  const wholeAmount = parts.shift().slice(0, 5);
  const decimalAmount = parts.join('').slice(0, 2);
  amountReceivedInput.value = parts.length || amountReceivedInput.value.includes('.')
    ? `${wholeAmount}.${decimalAmount}`
    : wholeAmount;
  amountReceivedInput.removeAttribute("aria-invalid");
  updateChange();
});

// GCash reference numbers are 13 digits. Anything else typed or pasted (spaces, dashes,
// letters) is dropped, so "1009 123 456789" becomes "1009123456789".
const GCASH_REF_DIGITS = 13;

gcashRefInput.addEventListener("input", () => {
  gcashRefInput.value = gcashRefInput.value.replace(/\D/g, "").slice(0, GCASH_REF_DIGITS);
  gcashRefInput.removeAttribute("aria-invalid");
});

document.getElementById("cashForm").addEventListener("submit", event => {
  event.preventDefault();
  if (salePending) return;

  const received = parseFloat(amountReceivedInput.value);
  const total = cartTotal();

  if (isNaN(received) || received < total) {
    amountReceivedInput.setAttribute("aria-invalid", "true");
    showDialog(
      "Payment Not Accepted",
      isNaN(received) ? "Enter the amount received." : "The amount received is less than the total."
    );
    return;
  }

  const change = received - total;
  const tx = buildTransaction("Cash", received, change);
  showDialog(
    "Complete Sale",
    `Record a cash payment of ${formatPeso(received)} for a total of ${formatPeso(total)}? Change due: ${formatPeso(change)}.`,
    () => completeSale(tx, "cashModal", document.getElementById("confirmCashBtn")),
    null,
    { confirmText: "Complete Sale" }
  );
});

document.getElementById("gcashForm").addEventListener("submit", event => {
  event.preventDefault();
  if (salePending) return;

  const refId = gcashRefInput.value.trim();

  if (!/^\d+$/.test(refId)) {
    gcashRefInput.setAttribute("aria-invalid", "true");
    showToast("Please enter the GCash reference number (numbers only).", true);
    return;
  }

  const tx = buildTransaction("GCash", null, null, refId);
  showDialog(
    "Complete Sale",
    `Record a GCash payment of ${formatPeso(tx.total_amount)} with reference number ${refId}?`,
    () => completeSale(tx, "gcashModal", document.getElementById("confirmGCashBtn")),
    null,
    { confirmText: "Complete Sale" }
  );
});

/* =========================
   RECEIPT
========================= */
// receipt.js reads the sale from here, clears it and prints the receipt.
function printReceipt(tx) {
  localStorage.setItem("crkdPendingReceipt", JSON.stringify(tx));
  const receiptWindow = window.open("../page/receipt.html", "Receipt", "width=420,height=700");
  if (!receiptWindow) {
    localStorage.removeItem("crkdPendingReceipt");
    showToast("The receipt window was blocked. Allow pop-ups and try printing again.", true);
    return false;
  }

  receiptWindow.focus();
  return true;
}

// The sale is already saved and the checkout cleared; this only decides whether to print.
// If the receipt window is blocked, the prompt stays open so the cashier can try again.
function finishReceipt(print) {
  if (print && !printReceipt(receiptTx)) return;
  hideModal("receiptModal");
  receiptTx = null;
}

document.getElementById("receiptYesBtn").addEventListener("click", () => finishReceipt(true));
document.getElementById("receiptNoBtn").addEventListener("click", () => finishReceipt(false));

/* =========================
   PAGE LOAD
========================= */
document.querySelector('[data-action="logout"]').addEventListener("click", logout);
document.querySelector('[data-action="switch-to-dashboard"]').addEventListener("click", switchToDashboard);
document.getElementById("cancelCheckoutBtn").addEventListener("click", confirmCancelCheckout);

const userName = localStorage.getItem("userName");
if (userName) {
  document.querySelectorAll(".pos-user-name, .profile-card-header span").forEach(element => {
    element.textContent = userName;
  });
}

renderCheckout();
UI.cardSkeletons(grid, { count: 8, tag: "li", cardClass: "product-card", mediaHeight: "160px", lines: 3 });
loadProducts();
// Stock changes from other tills (POST /api/POS/Transaction), exchanges and product edits show up without
// a reload, and the checkout is fitted to the new stock.
Live.on(["products", "exchanges"], () => loadProducts({ quiet: true }));
// So do coupons the owner creates, turns off or deletes, ones that get used up, and changes to the
// staff manual discount limit.
Live.on(["discounts"], loadAvailableDiscounts);
