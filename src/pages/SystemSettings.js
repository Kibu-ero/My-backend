import React, { useState, useEffect } from 'react';
import apiClient from '../api/client';
import { FiSave, FiPlus, FiTrash2, FiEdit } from 'react-icons/fi';

const SystemSettings = () => {
  const [settings, setSettings] = useState({
    system_name: '',
    company_name: '',
    contact_email: '',
    email_notifications: false,
    maintenance_mode: false,
    backup_frequency: 'daily',
    max_login_attempts: 3,
    session_timeout: 30,
    water_rate: 0,
    late_payment_fee: 0,
    due_date_grace_period: 3,
    senior_citizen_discount: 5
  });
  const [waterRates, setWaterRates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notification, setNotification] = useState('');
  const [activeTab, setActiveTab] = useState('general');
  const [editingRate, setEditingRate] = useState(null);
  const [newRate, setNewRate] = useState({
    consumption_min: '',
    consumption_max: '',
    rate_per_cubic_meter: '',
    fixed_amount: ''
  });

  useEffect(() => {
    fetchSettings();
    fetchWaterRates();
  }, []);

  const fetchSettings = async () => {
    try {
      const response = await apiClient.get('/settings');
      setSettings(response.data);
      setLoading(false);
    } catch (error) {
      setError('Failed to load settings. Please try again.');
      setLoading(false);
    }
  };

  const fetchWaterRates = async () => {
    try {
      const response = await apiClient.get('/settings/water-rates');
      setWaterRates(response.data);
    } catch (error) {
      console.error('Failed to load water rates:', error);
    }
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setSettings(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await apiClient.put('/settings', settings);
      showNotification('Settings saved successfully!', 'success');
    } catch (error) {
      showNotification('Failed to save settings. Please try again.', 'error');
    }
  };

  const handleWaterRatesSubmit = async (e) => {
    e.preventDefault();
    try {
      await apiClient.put('/settings/water-rates', { rates: waterRates });
      showNotification('Water rates updated successfully!', 'success');
      fetchWaterRates();
    } catch (error) {
      showNotification('Failed to update water rates. Please try again.', 'error');
    }
  };

  const addNewRate = () => {
    if (newRate.consumption_min && (newRate.rate_per_cubic_meter || newRate.fixed_amount)) {
      const rate = {
        consumption_min: parseInt(newRate.consumption_min),
        consumption_max: newRate.consumption_max ? parseInt(newRate.consumption_max) : null,
        rate_per_cubic_meter: newRate.rate_per_cubic_meter ? parseFloat(newRate.rate_per_cubic_meter) : null,
        fixed_amount: newRate.fixed_amount ? parseFloat(newRate.fixed_amount) : null
      };
      setWaterRates([...waterRates, rate]);
      setNewRate({ consumption_min: '', consumption_max: '', rate_per_cubic_meter: '', fixed_amount: '' });
    }
  };

  const removeRate = (index) => {
    setWaterRates(waterRates.filter((_, i) => i !== index));
  };

  const showNotification = (message, type) => {
    setNotification({ message, type });
    setTimeout(() => setNotification(''), 3000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-6xl mx-auto">
      {/* Notification */}
      {notification && (
        <div className={`mb-6 p-4 rounded-lg shadow-md text-sm font-semibold text-center
          ${notification.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}
        >
          {notification.message}
        </div>
      )}

      {/* Tab Navigation */}
      <div className="bg-white/80 rounded-2xl shadow p-8 border border-gray-200 mb-6">
        <div className="flex space-x-4 mb-6">
          <button
            onClick={() => setActiveTab('general')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              activeTab === 'general' 
                ? 'bg-blue-600 text-white' 
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            General Settings
          </button>
          <button
            onClick={() => setActiveTab('water-rates')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              activeTab === 'water-rates' 
                ? 'bg-blue-600 text-white' 
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Water Rates
          </button>
        </div>

        {/* General Settings Tab */}
        {activeTab === 'general' && (
          <form onSubmit={handleSubmit} className="space-y-6">
            <h3 className="text-xl font-semibold text-blue-900 mb-6">General Settings</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-gray-700 font-medium mb-2">Company Name</label>
                <input
                  type="text"
                  name="company_name"
                  value={settings.company_name || ''}
                  onChange={handleChange}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
                  placeholder="Enter company name"
                />
              </div>
              
              <div>
                <label className="block text-gray-700 font-medium mb-2">Contact Email</label>
                <input
                  type="email"
                  name="contact_email"
                  value={settings.contact_email || ''}
                  onChange={handleChange}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
                  placeholder="Enter contact email"
                />
              </div>
              
              <div>
                <label className="block text-gray-700 font-medium mb-2">Late Payment Fee (₱)</label>
                <input
                  type="number"
                  name="late_payment_fee"
                  value={settings.late_payment_fee || ''}
                  onChange={handleChange}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
                  placeholder="Enter late payment fee"
                />
              </div>
              
              <div>
                <label className="block text-gray-700 font-medium mb-2">Due Date Grace Period (days)</label>
                <input
                  type="number"
                  name="due_date_grace_period"
                  value={settings.due_date_grace_period || ''}
                  onChange={handleChange}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
                  placeholder="Enter grace period"
                />
              </div>
              
              <div>
                <label className="block text-gray-700 font-medium mb-2">Senior Citizen Discount (%)</label>
                <input
                  type="number"
                  name="senior_citizen_discount"
                  value={settings.senior_citizen_discount || ''}
                  onChange={handleChange}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
                  placeholder="Enter discount percentage"
                />
              </div>
            </div>
            
            <button type="submit" className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition flex items-center gap-2">
              <FiSave /> Save Changes
            </button>
          </form>
        )}

        {/* Water Rates Tab */}
        {activeTab === 'water-rates' && (
          <div>
            <h3 className="text-xl font-semibold text-blue-900 mb-6">Water Rates Management</h3>
            
            {/* Current Rates Table */}
            <div className="mb-6">
              <h4 className="text-lg font-medium text-gray-800 mb-4">Current Water Rates</h4>
              <div className="bg-white rounded-lg border overflow-hidden">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Min (cu.m.)</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Max (cu.m.)</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Rate per cu.m. (₱)</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Fixed Amount (₱)</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {waterRates.map((rate, index) => (
                      <tr key={index}>
                        <td className="px-4 py-3 text-sm text-gray-900">{rate.consumption_min}</td>
                        <td className="px-4 py-3 text-sm text-gray-900">{rate.consumption_max || '∞'}</td>
                        <td className="px-4 py-3 text-sm text-gray-900">{rate.rate_per_cubic_meter || '-'}</td>
                        <td className="px-4 py-3 text-sm text-gray-900">{rate.fixed_amount || '-'}</td>
                        <td className="px-4 py-3 text-sm">
                          <button
                            onClick={() => removeRate(index)}
                            className="text-red-600 hover:text-red-800"
                          >
                            <FiTrash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Add New Rate Form */}
            <div className="bg-gray-50 rounded-lg p-6">
              <h4 className="text-lg font-medium text-gray-800 mb-4">Add New Rate</h4>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Min Consumption</label>
                  <input
                    type="number"
                    value={newRate.consumption_min}
                    onChange={(e) => setNewRate({...newRate, consumption_min: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
                    placeholder="10"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Max Consumption</label>
                  <input
                    type="number"
                    value={newRate.consumption_max}
                    onChange={(e) => setNewRate({...newRate, consumption_max: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
                    placeholder="20 (optional)"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Rate per cu.m. (₱)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={newRate.rate_per_cubic_meter}
                    onChange={(e) => setNewRate({...newRate, rate_per_cubic_meter: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
                    placeholder="30.00"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Fixed Amount (₱)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={newRate.fixed_amount}
                    onChange={(e) => setNewRate({...newRate, fixed_amount: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
                    placeholder="500.00"
                  />
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={addNewRate}
                  className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition flex items-center gap-2"
                >
                  <FiPlus className="w-4 h-4" /> Add Rate
                </button>
                <button
                  type="button"
                  onClick={handleWaterRatesSubmit}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition flex items-center gap-2"
                >
                  <FiSave className="w-4 h-4" /> Save All Rates
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SystemSettings; 