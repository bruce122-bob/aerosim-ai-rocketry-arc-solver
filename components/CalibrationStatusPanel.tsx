/**
 * Calibration Status Panel
 * Displays calibration status, error estimates, and accuracy report
 */

import React, { useState, useEffect } from 'react';
import {
  getCalibrationStatus,
  CalibrationStatus,
  clearCalibrationHistory
} from '../services/calibrationStatus';

interface Props {
  rocketName?: string;
}

const CalibrationStatusPanel: React.FC<Props> = ({ rocketName }) => {
  const [status, setStatus] = useState<CalibrationStatus>(getCalibrationStatus());
  const [showHistory, setShowHistory] = useState(false);

  // Refresh status
  const refreshStatus = () => {
    setStatus(getCalibrationStatus());
  };

  // Clear history
  const handleClearHistory = () => {
    if (confirm('Are you sure you want to clear all calibration history? This action cannot be undone.')) {
      clearCalibrationHistory();
      refreshStatus();
    }
  };

  // Periodically refresh status (in case other components add new calibration records)
  useEffect(() => {
    const interval = setInterval(refreshStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  if (!status.isCalibrated) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Calibration Status</h3>
          <span className="px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-sm font-medium">
            Not Calibrated
          </span>
        </div>
        
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            No calibration has been performed yet. Calibrating with real flight data can improve simulation accuracy.
          </p>
          
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-800">
              <strong>How to calibrate:</strong>
            </p>
            <ul className="mt-2 space-y-1 text-sm text-blue-700 list-disc list-inside">
              <li>Go to <strong>Analysis &rarr; Calibration</strong> tab and enter actual flight altitudes</li>
              <li>The system will automatically optimize k_thrust and k_drag parameters</li>
              <li>Multiple calibrations can improve accuracy</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  const accuracyColor = {
    High: 'bg-green-100 text-green-700',
    Medium: 'bg-yellow-100 text-yellow-700',
    Low: 'bg-red-100 text-red-700'
  }[status.estimatedAccuracy] || 'bg-gray-100 text-gray-700';

  const accuracyIcon = {
    High: '✅',
    Medium: '⚠️',
    Low: '❌'
  }[status.estimatedAccuracy] || '❓';

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6">
      {/* Title and Status */}
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-gray-900">Calibration Status</h3>
        <div className="flex items-center gap-3">
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${accuracyColor}`}>
            {accuracyIcon} {status.estimatedAccuracy}
          </span>
          <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-medium">
            Calibrated
          </span>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-gray-50 rounded-lg p-4">
          <div className="text-xs text-gray-500 mb-1">Mean Error</div>
          <div className="text-2xl font-bold text-gray-900">
            {status.meanErrorPercent.toFixed(1)}%
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {status.meanError.toFixed(2)} m
          </div>
        </div>

        <div className="bg-gray-50 rounded-lg p-4">
          <div className="text-xs text-gray-500 mb-1">Calibration Count</div>
          <div className="text-2xl font-bold text-gray-900">
            {status.calibrationCount}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {status.lastCalibrationTime
              ? new Date(status.lastCalibrationTime).toLocaleDateString()
              : 'Unknown'}
          </div>
        </div>

        <div className="bg-gray-50 rounded-lg p-4">
          <div className="text-xs text-gray-500 mb-1">Error Range</div>
          <div className="text-2xl font-bold text-gray-900">
            {status.minError.toFixed(1)} - {status.maxError.toFixed(1)} m
          </div>
          <div className="text-xs text-gray-500 mt-1">
            &plusmn;{status.stdDevError.toFixed(2)} m (std dev)
          </div>
        </div>
      </div>

      {/* Accuracy Assessment */}
      <div className={`border rounded-lg p-4 mb-4 ${
        status.estimatedAccuracy === 'High'
          ? 'bg-green-50 border-green-200'
          : status.estimatedAccuracy === 'Medium'
          ? 'bg-yellow-50 border-yellow-200'
          : 'bg-red-50 border-red-200'
      }`}>
        <div className="flex items-start">
          <span className="text-2xl mr-3">{accuracyIcon}</span>
          <div>
            <div className="font-semibold text-gray-900 mb-1">
              Accuracy Assessment: {status.estimatedAccuracy}
            </div>
            <div className="text-sm text-gray-700">
              {status.meanErrorPercent < 5 ? (
                <>
                  Simulation accuracy meets the <strong>&lt;5%</strong> target. System is well calibrated.
                </>
              ) : status.meanErrorPercent < 8 ? (
                <>
                  Simulation accuracy is approaching the target. Consider adding more calibration data to improve precision.
                </>
              ) : (
                <>
                  Simulation accuracy needs improvement. Review parameter settings and calibration data quality.
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Calibration History */}
      <div className="border-t border-gray-200 pt-4">
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            {showHistory ? 'Hide' : 'Show'} Calibration History ({status.history.length})
          </button>
          {status.history.length > 0 && (
            <button
              onClick={handleClearHistory}
              className="text-xs text-red-600 hover:text-red-700"
            >
              Clear History
            </button>
          )}
        </div>

        {showHistory && status.history.length > 0 && (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {status.history.slice(0, 10).map((record, i) => (
              <div
                key={i}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg text-sm"
              >
                <div className="flex-1">
                  <div className="font-medium text-gray-900">
                    {new Date(record.timestamp).toLocaleString()}
                  </div>
                  <div className="text-xs text-gray-600 mt-1">
                    Actual: {record.actualApogee.toFixed(1)}m | 
                    Simulated: {record.simulatedApogee.toFixed(1)}m
                  </div>
                </div>
                <div className="text-right">
                  <div className={`font-medium ${
                    record.errorPercent < 5
                      ? 'text-green-600'
                      : record.errorPercent < 10
                      ? 'text-yellow-600'
                      : 'text-red-600'
                  }`}>
                    {record.errorPercent.toFixed(1)}%
                  </div>
                  <div className="text-xs text-gray-500">
                    {record.error.toFixed(2)} m
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default CalibrationStatusPanel;
