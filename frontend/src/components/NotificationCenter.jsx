import React, { useMemo, useState } from 'react';
import { Bell, CheckCircle2, X } from 'lucide-react';

function formatDateTime(value) {
  return value ? new Date(value).toLocaleString() : '-';
}

export default function NotificationCenter({
  notifications = [],
  unreadCount = 0,
  loading = false,
  onMarkRead,
  onMarkAllRead,
  onOpenAction
}) {
  const [showAllNotifications, setShowAllNotifications] = useState(false);
  const unreadNotifications = useMemo(
    () => notifications.filter((notification) => !notification.isRead),
    [notifications]
  );

  const renderNotificationCard = (notification) => (
    <div
      key={notification.id}
      className={`rounded-lg border p-4 ${notification.isRead ? 'border-gray-200 bg-white' : 'border-blue-200 bg-blue-50'}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-medium text-gray-900">{notification.title}</p>
          <p className="text-sm text-gray-600 mt-1">{notification.message}</p>
          <p className="text-xs text-gray-500 mt-2">
            {notification.group_name ? `${notification.group_name} • ` : ''}
            {formatDateTime(notification.created_at)}
          </p>
        </div>
        {!notification.isRead && (
          <button
            type="button"
            onClick={() => onMarkRead(notification.id)}
            className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
          >
            <CheckCircle2 className="w-4 h-4" />
            Read
          </button>
        )}
      </div>

      {notification.actionUrl && (
        <button
          type="button"
          onClick={() => onOpenAction(notification)}
          className="mt-3 text-sm text-blue-600 hover:text-blue-700"
        >
          Open
        </button>
      )}
    </div>
  );

  return (
    <>
      <section className="bg-white rounded-lg shadow-sm p-6">
        <div className="flex items-center gap-2">
          <Bell className="w-5 h-5 text-blue-600" />
          <h2 className="text-lg font-semibold text-gray-900">Notifications</h2>
          <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-800">
            {unreadCount} unread
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 mt-4 mb-4">
          <button
            type="button"
            onClick={() => setShowAllNotifications(true)}
            className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700"
          >
            <Bell className="w-4 h-4" />
            Open all notifications
          </button>
          <button
            type="button"
            onClick={onMarkAllRead}
            disabled={loading || unreadCount === 0}
            className="text-sm text-blue-600 hover:text-blue-700 disabled:opacity-50"
          >
            Mark all as read
          </button>
        </div>
        {unreadNotifications.length === 0 ? (
          <p className="text-gray-600">No unread notifications.</p>
        ) : (
          <div className="space-y-3">
            {unreadNotifications.map(renderNotificationCard)}
          </div>
        )}
      </section>

      {showAllNotifications && (
        <div className="fixed inset-0 z-50 bg-black/40 px-4 py-6 sm:px-6" onClick={() => setShowAllNotifications(false)}>
          <div
            className="mx-auto max-w-3xl bg-white rounded-2xl shadow-2xl max-h-[85vh] overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <Bell className="w-5 h-5 text-blue-600" />
                <h2 className="text-lg font-semibold text-gray-900">Notifications</h2>
                <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-800">
                  {unreadCount} unread
                </span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={onMarkAllRead}
                  disabled={loading || unreadCount === 0}
                  className="text-sm text-blue-600 hover:text-blue-700 disabled:opacity-50"
                >
                  Mark all as read
                </button>
                <button
                  type="button"
                  onClick={() => setShowAllNotifications(false)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-6 overflow-y-auto max-h-[calc(85vh-72px)]">
              {notifications.length === 0 ? (
                <p className="text-gray-600">No notifications yet.</p>
              ) : (
                <div className="space-y-3">
                  {notifications.map(renderNotificationCard)}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
