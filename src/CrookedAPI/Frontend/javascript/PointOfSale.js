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
const variantForm = document.getElementById("variantForm");
const variantSize = document.getElementById("variantSize");
const variantColor = document.getElementById("variantColor");
const variantAvailability = document.getElementById("variantAvailability");
const addVariantBtn = document.getElementById("addVariantBtn");
const amountReceivedInput = document.getElementById("amountReceived");
const gcashRefInput = document.getElementById("gcashRefId");

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
// when that element was re-rendered in the meantime.
function restoreFocus(element) {
  if (element?.isConnected && element !== document.body) {
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
  profileCard.style.display = open ? "block" : "none";
  userIcon.setAttribute("aria-expanded", String(open));
}

userIcon.addEventListener("click", (event) => {
  event.stopPropagation();
  setProfileCardOpen(profileCard.style.display !== "block");
});

document.addEventListener("click", (event) => {
  if (!profileSection.contains(event.target)) setProfileCardOpen(false);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && profileCard.style.display === "block") {
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
    () => {
      localStorage.clear();
      window.location.href = "index.html";
    },
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
let activeCategory = "All";
let shownCategories = "";

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

async function loadProducts() {
  try {
    const res = await fetch("/api/POS/products");
    if (!res.ok) throw new Error(`Product request failed (${res.status})`);
    const products = await res.json();

    const groups = new Map();
    products.forEach(product => {
      const groupKey = JSON.stringify([product.product_Name, product.category]);
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey).push(product);
    });
    // Products with stock come first and out-of-stock ones go to the bottom; each part
    // keeps the API's A–Z order.
    productGroups = [...groups.values()].sort((a, b) => groupInStock(b) - groupInStock(a));
    renderCategoryTabs();
    renderProductGrid();
  } catch (err) {
    console.error("Error loading products:", err);
    grid.replaceChildren();
    showGridMessage("Unable to load products. Please try again.");
    productSearchStatus.textContent = "Products could not be loaded.";
  } finally {
    UI.doneLoading(grid);
  }
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
function cartTotal() {
  return Object.values(cart).reduce((sum, item) => sum + item.price * item.qty, 0);
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
  checkoutTotal.textContent = formatPeso(cartTotal());

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

function buildTransaction(method, received = null, change = null, refId = null) {
  return {
    referenceId: refId || generateReferenceId(),
    date_time: new Date().toISOString(),
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

async function processCheckout(tx) {
  const cartPayload = Object.values(cart).map(item => ({
    productId: item.id,
    quantity: item.qty
  }));

  try {
    const checkoutRes = await fetch("/api/POS/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cartPayload)
    });

    if (!checkoutRes.ok) throw new Error("Stock deduction failed");

    const transactionRes = await fetch("/api/POS/Transaction", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tx)
    });
    if (!transactionRes.ok) throw new Error("Transaction could not be saved");

    console.log("Checkout and transaction saved.");
    return true;
  } catch (err) {
    console.error("Error during checkout:", err);
    showToast("Checkout failed. Please try again.", true);
    return false;
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

  const saved = await processCheckout(tx);

  salePending = false;
  submitButton.removeAttribute("aria-disabled");
  submitButton.textContent = buttonText;
  if (!saved) return;

  const returnFocus = hideModal(modalId, { restore: false });
  clearCheckout();
  receiptTx = tx;
  showModal("receiptModal", returnFocus);
  announce("Payment complete. The sale was saved.");
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
function printReceipt(tx) {
  const receiptWindow = window.open("", "Receipt", "width=420,height=700");
  if (!receiptWindow) {
    showToast("The receipt window was blocked. Allow pop-ups and try printing again.", true);
    return false;
  }

  const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);

  const items = tx.items.map(item => `
    <div class="item">
      <div class="item-name">${escapeHtml(item.name)}</div>
      <div class="item-details">
        <span>${item.quantity} x ${formatPeso(item.price)}</span>
        <span>${formatPeso(item.quantity * item.price)}</span>
      </div>
    </div>
  `).join("");
  const paymentDetails = tx.payment_method === "Cash" ? `
    <div class="row"><span>Cash</span><span>${formatPeso(tx.amount_received)}</span></div>
    <div class="row"><span>Change</span><span>${formatPeso(tx.change_given)}</span></div>
  ` : `
    <div class="row"><span>Payment</span><span>${escapeHtml(tx.payment_method || "GCash")}</span></div>
    ${tx.referenceId ? `<div class="row"><span>Reference</span><span>${escapeHtml(tx.referenceId)}</span></div>` : ""}
  `;

  receiptWindow.document.write(`<!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Crooked Receipt</title>
        <style>
          * { box-sizing: border-box; }
          body {
            width: 72mm;
            margin: 0 auto;
            padding: 5mm 4mm;
            background: #fff;
            color: #000;
            font: 12px/1.4 "Courier New", monospace;
          }
          .receipt { width: 100%; }
          .center { text-align: center; }
          .shop-name {
            margin: 0;
            font-size: 23px;
            font-weight: 900;
            letter-spacing: 2px;
            line-height: 1.1;
          }
          .address { margin: 5px 0 12px; font-size: 11px; }
          .divider { border: 0; border-top: 1px dashed #000; margin: 9px 0; }
          .row, .item-details {
            display: flex;
            justify-content: space-between;
            gap: 8px;
          }
          .meta { font-size: 11px; }
          .meta div { margin: 2px 0; }
          .item { margin: 8px 0; }
          .item-name { overflow-wrap: anywhere; }
          .item-details { margin-top: 2px; padding-left: 8px; font-size: 11px; }
          .total { font-size: 15px; font-weight: bold; }
          .footer { margin-top: 14px; }
          @media print {
            @page { size: 80mm auto; margin: 0; }
            body { width: 72mm; padding: 4mm; }
          }
        </style>
      </head>
      <body>
        <main class="receipt">
          <header class="center">
            <h1 class="shop-name">CROOKED</h1>
            <p class="address">2057 Bagong Sikat St., Baclaran,<br>Parañaque City</p>
          </header>
          <hr class="divider">
          <section class="meta">
            <div>Receipt: ${escapeHtml(tx.referenceId)}</div>
            <div>Date: ${escapeHtml(new Date(tx.date_time).toLocaleString("en-PH"))}</div>
            <div>Cashier: ${escapeHtml(tx.assistedBy)}</div>
          </section>
          <hr class="divider">
          <section aria-label="Purchased items">${items}</section>
          <hr class="divider">
          <div class="row total"><span>TOTAL</span><span>${formatPeso(tx.total_amount)}</span></div>
          <hr class="divider">
          <section class="meta">${paymentDetails}</section>
          <hr class="divider">
          <footer class="center footer">
            <div>Thank you for shopping at</div>
            <strong>CROOKED</strong>
            <div>Please come again!</div>
          </footer>
        </main>
      </body>
    </html>
  `);
  receiptWindow.document.close();
  receiptWindow.focus();
  receiptWindow.print();
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
const userName = localStorage.getItem("userName");
if (userName) {
  document.querySelectorAll(".pos-user-name, .profile-card-header span").forEach(element => {
    element.textContent = userName;
  });
}

renderCheckout();
UI.cardSkeletons(grid, { count: 8, tag: "li", cardClass: "product-card", mediaHeight: "160px", lines: 3 });
loadProducts();
// Stock changes from other tills, exchanges and product edits show up without a reload.
Live.on(["products", "exchanges"], loadProducts);
