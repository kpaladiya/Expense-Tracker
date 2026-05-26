import React from 'react';

export default function TransferSuggestions({ suggestions = [], formatCurrency }) {
  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-5">
      <h3 className="text-base font-semibold text-blue-900 mb-3">Recommended settle-up payments</h3>
      {suggestions.length === 0 ? (
        <p className="text-sm text-blue-800">
          No additional member-to-member transfers are needed.
        </p>
      ) : (
        <div className="space-y-3">
          {suggestions.map((item, index) => (
            <div
              key={`${item.fromUserId}-${item.toUserId}-${index}`}
              className="flex flex-col gap-2 rounded-lg bg-white/80 p-4 md:flex-row md:items-center md:justify-between"
            >
              <div>
                <p className="font-medium text-gray-900">{item.fromName} pays {item.toName}</p>
                <p className="text-sm text-gray-600">This transfer closes part of the open balance.</p>
              </div>
              <p className="text-lg font-semibold text-blue-700">{formatCurrency(item.amount)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
