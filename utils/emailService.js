const nodemailer = require('nodemailer');

const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASSWORD,
  EMAIL_HOST,
  EMAIL_PORT,
  EMAIL_SECURE,
  EMAIL_FROM,
  EMAIL_PASSWORD,
  ORDERS_EMAIL,
  SUPPORT_EMAIL,
  FROM_CONTACT_EMAIL,
  ADMIN_EMAILS
} = process.env;

let transporter;

function getTransporter() {
  if (transporter) return transporter;

  // Prefer new EMAIL_* settings if present, fall back to old SMTP_*.
  const host = EMAIL_HOST || SMTP_HOST;
  const port = Number(EMAIL_PORT || SMTP_PORT) || 465;
  const secure = EMAIL_SECURE != null
    ? String(EMAIL_SECURE).toLowerCase() === 'true'
    : true;
  const user = EMAIL_FROM || SMTP_USER;
  const pass = EMAIL_PASSWORD || SMTP_PASSWORD;

  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass
    }
  });

  return transporter;
}

function getDefaultFrom() {
  return `"Anime India" <${EMAIL_FROM || SMTP_USER || ORDERS_EMAIL || SUPPORT_EMAIL}>`;
}

async function sendMail(options) {
  const tx = getTransporter();
  const mailOptions = {
    from: options.from || getDefaultFrom(),
    to: options.to,
    subject: options.subject,
    text: options.text,
    html: options.html
  };

  return tx.sendMail(mailOptions);
}

async function sendContactMessage({ name, email, phone, subject, message }) {
  const to = SUPPORT_EMAIL || FROM_CONTACT_EMAIL || ADMIN_EMAILS || SMTP_USER;
  if (!to) {
    throw new Error('No support email configured. Set SUPPORT_EMAIL in .env');
  }
  const safeSubject = subject && subject.trim() ? subject.trim() : 'New contact form submission';

  const html = `
    <h2>New Contact Form Submission</h2>
    <p><strong>Name:</strong> ${name || 'N/A'}</p>
    <p><strong>Email:</strong> ${email || 'N/A'}</p>
    <p><strong>Phone:</strong> ${phone || 'N/A'}</p>
    <p><strong>Subject:</strong> ${safeSubject}</p>
    <p><strong>Message:</strong></p>
    <p>${(message || '').replace(/\n/g, '<br>')}</p>
  `;

  const text = `
New Contact Form Submission

Name: ${name || 'N/A'}
Email: ${email || 'N/A'}
Phone: ${phone || 'N/A'}
Subject: ${safeSubject}

Message:
${message || ''}
`;

  return sendMail({
    to,
    subject: `[Contact] ${safeSubject}`,
    html,
    text
  });
}

async function sendNewOrderNotification(order) {
  if (!order) return;

  const to = ORDERS_EMAIL || ADMIN_EMAILS || SMTP_USER;
  if (!to) return;

  const customer = order.customer || {};
  const shipping = order.shippingAddress || {};

  const title = `New Order #${order.orderNumber || order._id}`;

  const itemsHtml = (order.items || [])
    .map(item => {
      return `
        <tr>
          <td>${item.name || 'Product'}</td>
          <td>${item.size || '-'}</td>
          <td>${item.color || '-'}</td>
          <td>${item.quantity}</td>
          <td>₹${Number(item.price || 0).toLocaleString('en-IN')}</td>
        </tr>
      `;
    })
    .join('');

  const html = `
    <h2>${title}</h2>

    <h3>Customer</h3>
    <p>
      ${customer.name || shipping.name || ''}<br>
      ${customer.email || shipping.email || ''}<br>
      ${customer.phone || shipping.phone || ''}
    </p>

    <h3>Shipping Address</h3>
    <p>
      ${shipping.name || ''}<br>
      ${shipping.address || ''}<br>
      ${shipping.city || ''}, ${shipping.state || ''} ${shipping.pincode || ''}<br>
      ${shipping.country || ''}
    </p>

    <h3>Items</h3>
    <table border="1" cellpadding="6" cellspacing="0" style="border-collapse: collapse;">
      <thead>
        <tr>
          <th align="left">Product</th>
          <th align="left">Size</th>
          <th align="left">Color</th>
          <th align="right">Qty</th>
          <th align="right">Price</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml}
      </tbody>
    </table>

    <h3>Totals</h3>
    <p>
      Subtotal: ₹${Number(order.subtotal || 0).toLocaleString('en-IN')}<br>
      Discount: ₹${Number(order.discount || 0).toLocaleString('en-IN')}<br>
      Shipping: ₹${Number(order.shippingCharges || 0).toLocaleString('en-IN')}<br>
      <strong>Total: ₹${Number(order.total || 0).toLocaleString('en-IN')}</strong><br>
      Payment: ${order.paymentMethod || '-'} (${order.paymentStatus || '-'})
    </p>
  `;

  const text = `
${title}

Customer:
${customer.name || shipping.name || ''}
${customer.email || shipping.email || ''}
${customer.phone || shipping.phone || ''}

Shipping Address:
${shipping.name || ''}
${shipping.address || ''}
${shipping.city || ''}, ${shipping.state || ''} ${shipping.pincode || ''}
${shipping.country || ''}

Totals:
Subtotal: ₹${order.subtotal || 0}
Discount: ₹${order.discount || 0}
Shipping: ₹${order.shippingCharges || 0}
Total: ₹${order.total || 0}
Payment: ${order.paymentMethod || '-'} (${order.paymentStatus || '-'})
`;

  return sendMail({
    to,
    subject: title,
    html,
    text
  });
}

/**
 * Send order confirmation email to customer with order details and product image.
 * This is separate from the internal orders@ notification.
 */
async function sendOrderConfirmationToCustomer(order) {
  if (!order) return;

  const customer = order.customer || {};
  const shipping = order.shippingAddress || {};
  const to = customer.email || shipping.email;
  if (!to) return;

  const orderNumber = order.orderNumber || order._id;
  const title = `Thank you for your order #${orderNumber}`;

  // Base URL for email images: backend serves /uploads (see server.js). Use EMAIL_IMAGE_BASE_URL or BACKEND_URL.
  const IMAGE_BASE = (process.env.EMAIL_IMAGE_BASE_URL || process.env.BACKEND_URL || process.env.STORE_FRONTEND_URL || 'https://store.animeindia.org').replace(/\/$/, '');

  const itemsHtml = (order.items || [])
    .map(item => {
      const product = item.product || {};
      let imagePath = '';

      // 1) Prefer image stored on order at placement time (always available, correct path)
      if (item.image && typeof item.image === 'string' && item.image.trim()) {
        imagePath = item.image.trim();
      }
      if (!imagePath && Array.isArray(item.images) && item.images.length > 0 && typeof item.images[0] === 'string') {
        imagePath = item.images[0].trim();
      }

      // 2) From populated product: color-specific then first image
      if (!imagePath && product.imagesByColor && item.color) {
        const byColor = product.imagesByColor;
        const colorImages = typeof byColor.get === 'function' ? (byColor.get(item.color) || []) : (byColor[item.color] || []);
        const first = Array.isArray(colorImages) ? colorImages[0] : colorImages;
        if (typeof first === 'number' && Array.isArray(product.images) && product.images[first] != null) {
          imagePath = String(product.images[first]).trim();
        } else if (typeof first === 'string') {
          imagePath = first.trim();
        }
      }
      if (!imagePath && Array.isArray(product.images) && product.images.length > 0 && typeof product.images[0] === 'string') {
        imagePath = product.images[0].trim();
      }

      // Build full absolute URL for email (clients need absolute URLs). Backend serves /uploads (server.js).
      let imageHtml = '';
      if (imagePath) {
        const absoluteUrl = imagePath.startsWith('http://') || imagePath.startsWith('https://')
          ? imagePath
          : `${IMAGE_BASE}${imagePath.startsWith('/') ? '' : '/'}${imagePath}`;
        const alt = (item.name || product.name || 'Product').replace(/"/g, '&quot;');
        imageHtml = `<td style="padding:8px 6px;vertical-align:top;" width="90">
          <img src="${absoluteUrl}" alt="${alt}" width="80" height="80" border="0" style="max-width:80px;max-height:80px;width:80px;height:80px;border-radius:6px;display:block;object-fit:cover;">
        </td>`;
      } else {
        imageHtml = '<td style="padding:8px 6px;vertical-align:top;" width="90"></td>';
      }

      return `
        <tr>
          ${imageHtml}
          <td style="padding:8px 6px;">
            <strong>${item.name || product.name || 'Product'}</strong><br>
            <span style="font-size:12px;color:#555;">
              Size: ${item.size || '-'} | Color: ${item.color || '-'}
            </span>
          </td>
          <td style="padding:8px 6px;" align="center">${item.quantity}</td>
          <td style="padding:8px 6px;" align="right">₹${Number(item.price || 0).toLocaleString('en-IN')}</td>
        </tr>
      `;
    })
    .join('');

  const html = `
    <div style="font-family: Arial, sans-serif; font-size: 14px; color: #222;">
      <h2 style="font-size:20px;margin-bottom:8px;">${title}</h2>
      <p style="margin:0 0 12px 0;">
        Hi ${customer.name || shipping.name || ''},<br>
        Thank you for shopping with <strong>Anime India</strong>! Your order has been received.
      </p>

      <h3 style="font-size:16px;margin:16px 0 8px;">Order Summary</h3>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <thead>
          <tr>
            <th align="left" style="padding:8px 6px;font-size:13px;border-bottom:1px solid #e0e0e0;">Item</th>
            <th align="center" style="padding:8px 6px;font-size:13px;border-bottom:1px solid #e0e0e0;">Qty</th>
            <th align="right" style="padding:8px 6px;font-size:13px;border-bottom:1px solid #e0e0e0;">Price</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>

      <h3 style="font-size:16px;margin:18px 0 8px;">Totals</h3>
      <p style="margin:0 0 12px 0;">
        Subtotal: ₹${Number(order.subtotal || 0).toLocaleString('en-IN')}<br>
        Discount: ₹${Number(order.discount || 0).toLocaleString('en-IN')}<br>
        Shipping: ₹${Number(order.shippingCharges || 0).toLocaleString('en-IN')}<br>
        <strong>Total: ₹${Number(order.total || 0).toLocaleString('en-IN')}</strong><br>
        Payment method: ${order.paymentMethod || '-'} (${order.paymentStatus || '-'})
      </p>

      <h3 style="font-size:16px;margin:18px 0 8px;">Shipping Address</h3>
      <p style="margin:0 0 18px 0;">
        ${shipping.name || ''}<br>
        ${shipping.address || ''}<br>
        ${shipping.city || ''}, ${shipping.state || ''} ${shipping.pincode || ''}<br>
        ${shipping.country || ''}
      </p>

      <p style="margin:0 0 8px 0;">
        You will receive another email once your order is shipped with tracking details.
      </p>
      <p style="margin:0;">
        For any questions, reply to this email or contact us at <a href="mailto:${SUPPORT_EMAIL || 'support@store.animeindia.org'}">${SUPPORT_EMAIL || 'support@store.animeindia.org'}</a>.
      </p>
    </div>
  `;

  const text = `
${title}

Customer:
${customer.name || shipping.name || ''}
${to}

Items:
${(order.items || [])
  .map(item => {
    const name = item.name || (item.product && item.product.name) || 'Product';
    return `- ${name} (Size: ${item.size || '-'}, Color: ${item.color || '-'}, Qty: ${item.quantity}, Price: ₹${item.price || 0})`;
  })
  .join('\n')}

Totals:
Subtotal: ₹${order.subtotal || 0}
Discount: ₹${order.discount || 0}
Shipping: ₹${order.shippingCharges || 0}
Total: ₹${order.total || 0}
Payment: ${order.paymentMethod || '-'} (${order.paymentStatus || '-'})

Shipping Address:
${shipping.name || ''}
${shipping.address || ''}
${shipping.city || ''}, ${shipping.state || ''} ${shipping.pincode || ''}
${shipping.country || ''}
`;

  return sendMail({
    to,
    subject: title,
    html,
    text
  });
}

/**
 * Send abandoned cart email to customer (e.g. "You left something behind – this would look great with …").
 * @param {Object} opts - { to, customerName, items: [ { name, price, quantity, image? } ], cartUrl }
 */
async function sendAbandonedCartEmail(opts) {
  if (!opts || !opts.to) return;
  const to = opts.to;
  const name = opts.customerName || 'there';
  const items = Array.isArray(opts.items) ? opts.items : [];
  const cartUrl = opts.cartUrl || (process.env.STORE_FRONTEND_URL || 'https://store.animeindia.org').replace(/\/$/, '') + '/cart';
  const IMAGE_BASE = (process.env.EMAIL_IMAGE_BASE_URL || process.env.BACKEND_URL || process.env.STORE_FRONTEND_URL || 'https://store.animeindia.org').replace(/\/$/, '');

  const subject = items.length > 0
    ? `You left something behind – complete your order at Anime India`
    : `Your cart at Anime India`;

  const itemsRows = items.slice(0, 10).map(item => {
    const price = Number(item.price || 0);
    const qty = Math.max(1, parseInt(item.quantity, 10) || 1);
    const total = price * qty;
    let img = '';
    const imagePath = item.image || (item.images && item.images[0]);
    if (imagePath && typeof imagePath === 'string') {
      const absoluteUrl = imagePath.startsWith('http') ? imagePath : `${IMAGE_BASE}${imagePath.startsWith('/') ? '' : '/'}${imagePath}`;
      img = `<img src="${absoluteUrl}" alt="" width="60" height="60" style="max-width:60px;max-height:60px;object-fit:cover;border-radius:6px;">`;
    }
    return `
      <tr>
        <td style="padding:8px;vertical-align:middle;">${img} ${(item.name || 'Product').replace(/</g, '&lt;')}</td>
        <td style="padding:8px;" align="center">${qty}</td>
        <td style="padding:8px;" align="right">₹${total.toLocaleString('en-IN')}</td>
      </tr>`;
  }).join('');

  const html = `
    <div style="font-family:Arial,sans-serif;font-size:14px;color:#222;">
      <h2 style="font-size:20px;">Hey ${name}, this would look great on you!</h2>
      <p>You left something in your cart at Anime India. Complete your purchase before it’s gone.</p>
      ${itemsRows ? `
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:16px 0;">
        <thead>
          <tr>
            <th align="left" style="padding:8px;border-bottom:1px solid #eee;">Product</th>
            <th align="center" style="padding:8px;border-bottom:1px solid #eee;">Qty</th>
            <th align="right" style="padding:8px;border-bottom:1px solid #eee;">Price</th>
          </tr>
        </thead>
        <tbody>${itemsRows}</tbody>
      </table>
      ` : ''}
      <p style="margin:20px 0;">
        <a href="${cartUrl}" style="display:inline-block;padding:12px 24px;background:#1a1a1a;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Complete your purchase</a>
      </p>
      <p style="color:#666;font-size:12px;">If you didn’t add these items, you can ignore this email.</p>
    </div>`;

  const text = `Hey ${name}, you left items in your cart at Anime India. Complete your purchase: ${cartUrl}`;

  return sendMail({ to, subject, html, text });
}

module.exports = {
  sendMail,
  sendContactMessage,
  sendNewOrderNotification,
  sendOrderConfirmationToCustomer,
  sendAbandonedCartEmail
};

