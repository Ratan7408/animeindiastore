const EventNotification = require('../models/EventNotification');
const { sendEventReminderEmail } = require('../utils/emailService');

let reminderTimer = null;

async function runEventReminderCycle() {
  try {
    const now = new Date();
    const reminderThreshold = new Date(now);
    reminderThreshold.setDate(reminderThreshold.getDate() + 7);
    reminderThreshold.setHours(23, 59, 59, 999);

    const pending = await EventNotification.find({
      reminderSentAt: null,
      eventDate: { $gte: now, $lte: reminderThreshold }
    }).limit(200);

    for (const entry of pending) {
      try {
        await sendEventReminderEmail({
          to: entry.email,
          name: entry.name,
          eventTitle: entry.eventTitle,
          eventDate: entry.eventDate,
          eventCity: entry.eventCity,
          eventLink: entry.eventLink
        });
        entry.reminderSentAt = new Date();
        await entry.save();
      } catch (mailErr) {
        console.warn('[EventReminder] mail failed for', entry.email, mailErr.message || mailErr);
      }
    }
  } catch (error) {
    console.error('[EventReminder] cycle failed:', error.message || error);
  }
}

function startEventReminderJob() {
  if (reminderTimer) return;

  // Run once shortly after server boot, then every 6 hours.
  setTimeout(() => {
    runEventReminderCycle().catch(() => {});
  }, 15000);

  reminderTimer = setInterval(() => {
    runEventReminderCycle().catch(() => {});
  }, 6 * 60 * 60 * 1000);
}

module.exports = {
  startEventReminderJob,
  runEventReminderCycle
};
