"use client";

import { useState, useEffect } from "react";
import Layout from "@/components/Layout";
import Loader from "@/components/Loader";
import useProgress from "@/lib/useProgress";

export default function LocationItemsManager() {
  const [locations, setLocations] = useState([]);
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [currentLocationData, setCurrentLocationData] = useState(null);
  const [allTenders, setAllTenders] = useState([]);
  const [allCategories, setAllCategories] = useState([]);
  const [locationTenders, setLocationTenders] = useState([]);
  const [locationCategories, setLocationCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const { progress, start, onFetch, onProcess, complete } = useProgress();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showEditModal, setShowEditModal] = useState(false);
  const [editFormData, setEditFormData] = useState({
    name: "",
    address: "",
    phone: "",
    email: "",
    code: "",
  });

  useEffect(() => {
    fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
    try {
      setLoading(true);
      start();
      setError("");

      // Fetch store data with locations
      onFetch();
      const storeRes = await fetch("/api/setup/setup");
      const storeData = await storeRes.json();

      let firstLocationId = null;
      if (storeData.store && storeData.store.locations) {
        setLocations(storeData.store.locations);
        if (storeData.store.locations.length > 0) {
          firstLocationId = storeData.store.locations[0]._id;
          setSelectedLocation(firstLocationId);
        }
      }

      // Fetch all tenders
      onProcess();
      const tendersRes = await fetch("/api/setup/tenders");
      const tendersData = await tendersRes.json();
      if (tendersData.success && tendersData.tenders) {
        setAllTenders(tendersData.tenders);
      } else {
        console.warn("Failed to fetch tenders:", tendersData);
      }

      // Fetch all categories
      const categoriesRes = await fetch("/api/categories");
      const categoriesData = await categoriesRes.json();
      console.log("Categories API Response:", categoriesData);
      
      let categoriesArray = [];
      if (Array.isArray(categoriesData)) {
        // Response is a direct array
        categoriesArray = categoriesData;
        console.log("Categories as direct array:", categoriesArray);
      } else if (categoriesData.success && Array.isArray(categoriesData.categories)) {
        // Response is wrapped with success flag
        categoriesArray = categoriesData.categories;
        console.log("Categories from success response:", categoriesArray);
      } else if (Array.isArray(categoriesData.categories)) {
        // Response has categories property
        categoriesArray = categoriesData.categories;
        console.log("Categories from categories property:", categoriesArray);
      } else {
        console.warn("Failed to fetch categories. Response structure:", categoriesData);
      }
      
      setAllCategories(categoriesArray);
      
      if (categoriesArray.length === 0) {
        console.warn("No categories found in database. Total categories available: 0");
      } else {
        console.log(`Successfully loaded ${categoriesArray.length} categories`);
      }

      // Fetch location items for the first location only if it exists
      if (firstLocationId) {
        await fetchLocationItemsForInit(firstLocationId, storeData.store.locations);
      }
    } catch (err) {
      console.error("Error fetching data:", err);
      setError("Failed to load initial data");
    } finally {
      complete();
      setLoading(false);
    }
  };

  const fetchLocationItems = async (locationId) => {
    if (!locationId) {
      console.warn("fetchLocationItems called with invalid locationId:", locationId);
      setError("Location ID is required");
      return;
    }

    try {
      setLoading(true);
      setError("");
      const res = await fetch(`/api/setup/location-items?locationId=${locationId}`);
      const data = await res.json();

      if (data.success) {
        const tenderIds = Array.isArray(data.location.tenders)
          ? data.location.tenders.map((t) => (typeof t === 'string' ? t : t._id))
          : [];
        const categoryIds = Array.isArray(data.location.categories)
          ? data.location.categories.map((c) => (typeof c === 'string' ? c : c._id))
          : [];
        
        setLocationTenders(tenderIds);
        setLocationCategories(categoryIds);
      } else {
        setError(data.message || "Failed to load location items");
      }
    } catch (err) {
      console.error("Error fetching location items:", err);
      setError("Failed to load location items");
    } finally {
      setLoading(false);
    }
  };

  const fetchLocationItemsForInit = async (locationId, allLocations) => {
    if (!locationId) {
      console.warn("fetchLocationItemsForInit called with invalid locationId:", locationId);
      return;
    }

    try {
      const res = await fetch(`/api/setup/location-items?locationId=${locationId}`);
      const data = await res.json();
      
      if (data.success) {
        const tenderIds = Array.isArray(data.location.tenders)
          ? data.location.tenders.map((t) => (typeof t === 'string' ? t : t._id || t))
          : [];
        const categoryIds = Array.isArray(data.location.categories)
          ? data.location.categories.map((c) => (typeof c === 'string' ? c : c._id || c))
          : [];
        
        setLocationTenders(tenderIds);
        setLocationCategories(categoryIds);
        const location = allLocations.find((loc) => loc._id === locationId);
        setCurrentLocationData(location);
      } else {
        console.warn("Failed to fetch location items:", data.message);
      }
    } catch (err) {
      console.error("Error fetching location items during init:", err);
    }
  };

  const handleLocationChange = (locationId) => {
    if (!locationId) {
      console.warn("handleLocationChange called with empty locationId");
      return;
    }

    setSelectedLocation(locationId);
    const location = locations.find((loc) => loc._id === locationId);
    setCurrentLocationData(location);
    fetchLocationItems(locationId);
  };

  const handleEditLocation = () => {
    if (currentLocationData) {
      setEditFormData({
        name: currentLocationData.name || "",
        address: currentLocationData.address || "",
        phone: currentLocationData.phone || "",
        email: currentLocationData.email || "",
        code: currentLocationData.code || "",
      });
      setShowEditModal(true);
    }
  };

  const handleSaveLocationEdit = async () => {
    try {
      setSaving(true);
      setError("");

      if (!editFormData.name.trim()) {
        setError("Location name is required");
        setSaving(false);
        return;
      }

      const res = await fetch(`/api/setup/update-location?locationId=${selectedLocation}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editFormData),
      });

      const data = await res.json();

      if (res.ok && data.location) {
        setSuccess("Location updated successfully!");
        setShowEditModal(false);
        
        // Update locations list
        const updatedLocations = locations.map((loc) =>
          loc._id === selectedLocation ? { ...loc, ...editFormData } : loc
        );
        setLocations(updatedLocations);
        setCurrentLocationData({ ...currentLocationData, ...editFormData });
        
        setTimeout(() => setSuccess(""), 3000);
      } else {
        setError(data.message || "Failed to update location");
      }
    } catch (err) {
      console.error("Error updating location:", err);
      setError("Failed to update location");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleTender = async (tenderId) => {
    if (!selectedLocation) {
      setError("Please select a location first");
      return;
    }

    try {
      setSaving(true);
      setError("");
      
      // Normalize tenderId for comparison
      const normalizedTenderId = typeof tenderId === 'string' ? tenderId : tenderId?.toString();
      const isSelected = locationTenders.some(
        (id) => id === normalizedTenderId || id?.toString() === normalizedTenderId
      );
      
      const method = isSelected ? "DELETE" : "POST";

      const res = await fetch(`/api/setup/location-items?locationId=${selectedLocation}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenderId: normalizedTenderId }),
      });

      const data = await res.json();

      if (data.success) {
        const newTenderIds = Array.isArray(data.location.tenders)
          ? data.location.tenders.map((t) => (typeof t === 'string' ? t : t._id || t))
          : [];
        
        setLocationTenders(newTenderIds);
        setSuccess(`Tender ${isSelected ? "removed" : "added"} successfully`);
        setTimeout(() => setSuccess(""), 2000);
      } else {
        setError(data.message || "Failed to update tender");
      }
    } catch (err) {
      console.error("Error updating tender:", err);
      setError("Failed to update tender");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleCategory = async (categoryId) => {
    if (!selectedLocation) {
      setError("Please select a location first");
      return;
    }

    try {
      setSaving(true);
      setError("");
      
      // Normalize categoryId for comparison
      const normalizedCategoryId = typeof categoryId === 'string' ? categoryId : categoryId?.toString();
      const isSelected = locationCategories.some(
        (id) => id === normalizedCategoryId || id?.toString() === normalizedCategoryId
      );
      
      const method = isSelected ? "DELETE" : "POST";

      console.log(`${method === 'POST' ? 'Adding' : 'Removing'} category ${normalizedCategoryId} for location ${selectedLocation}`);
      console.log('Current locationCategories:', locationCategories);

      const res = await fetch(`/api/setup/location-items?locationId=${selectedLocation}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId: normalizedCategoryId }),
      });

      const data = await res.json();

      console.log('API Response:', data);

      if (data.success) {
        const newCategoryIds = Array.isArray(data.location.categories)
          ? data.location.categories.map((c) => (typeof c === 'string' ? c : c._id || c))
          : [];
        
        console.log('Updated locationCategories:', newCategoryIds);
        setLocationCategories(newCategoryIds);
        setSuccess(`Category ${isSelected ? "removed" : "added"} successfully`);
        setTimeout(() => setSuccess(""), 2000);
      } else {
        setError(data.message || "Failed to update category");
      }
    } catch (err) {
      console.error("Error updating category:", err);
      setError("Failed to update category");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="min-h-screen flex items-center justify-center">
          <Loader size="lg" text="Loading location items..." progress={progress} />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="page-container">
        <div className="page-content">
          {/* Header */}
          <div className="page-header flex-col items-start">
            <h1 className="page-title">Location Tenders & Categories</h1>
            <p className="page-subtitle">Manage which tenders and categories are available at each store location</p>
          </div>

          {/* Messages */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg mb-4">
              {error}
            </div>
          )}
          {success && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-lg mb-4">
              {success}
            </div>
          )}

          {/* Location Selector */}
          <div className="content-card mb-4 md:mb-6">
            <label className="form-label">
              Select Location
            </label>
            <div className="flex flex-col sm:flex-row gap-3">
              <select
                value={selectedLocation || ""}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value) {
                    handleLocationChange(value);
                  }
                }}
                className="form-select flex-1 max-w-md"
              >
                <option value="">-- Select a Location --</option>
                {locations && locations.length > 0 ? (
                  locations.map((loc) => (
                    <option key={loc._id} value={loc._id}>
                      {loc.name}
                    </option>
                  ))
                ) : (
                  <option disabled>No locations available</option>
                )}
              </select>
              <button
                onClick={handleEditLocation}
                disabled={!currentLocationData}
                className="btn-action-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Edit Location
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
            {/* Tenders Section */}
            <div className="content-card">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Available Tenders</h2>
              <div className="space-y-3">
                {allTenders.length === 0 ? (
                  <p className="text-gray-500">No tenders available</p>
                ) : (
                  allTenders.map((tender) => {
                    const tenderId = tender._id || tender.id;
                    const isChecked = locationTenders.some(
                      (id) => id === tenderId || id === tender._id?.toString() || id?.toString() === tenderId?.toString()
                    );
                    
                    return (
                      <label key={tenderId} className="flex items-center p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer transition active:scale-[0.99]">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleTender(tenderId)}
                          disabled={saving}
                          className="w-5 h-5 text-sky-600 border-gray-300 rounded"
                        />
                        <div className="ml-3 flex-1">
                          <p className="font-medium text-gray-900">{tender.name}</p>
                          <p className="text-sm text-gray-600">{tender.classification}</p>
                        </div>
                        <div
                          className="w-5 h-5 rounded-full border border-gray-300"
                          style={{ backgroundColor: tender.buttonColor }}
                        />
                      </label>
                    );
                  })
                )}
              </div>
            </div>

            {/* Categories Section */}
            <div className="content-card">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Available Categories</h2>
              <div className="space-y-3">
                {allCategories.length === 0 ? (
                  <p className="text-gray-500">No categories available</p>
                ) : (
                  allCategories.map((category) => {
                    const categoryId = category._id || category.id;
                    const isChecked = locationCategories.some(
                      (id) => id === categoryId || id === category._id?.toString() || id?.toString() === categoryId?.toString()
                    );
                    
                    return (
                      <label key={categoryId} className="flex items-center p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer transition active:scale-[0.99]">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleCategory(categoryId)}
                          disabled={saving}
                          className="w-5 h-5 text-sky-600 border-gray-300 rounded"
                        />
                        <div className="ml-3 flex-1">
                          <p className="font-medium text-gray-900">{category.name}</p>
                        </div>
                      </label>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Assign Tenders to Devices */}
          {selectedLocation && (
            <div className="content-card mt-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Assign Tenders to Devices</h2>
              <p className="text-gray-600 text-sm mb-4">
                Tenders assigned to <span className="font-medium text-gray-900">{currentLocationData?.name}</span>
              </p>

              {locationTenders.length === 0 ? (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-yellow-800">
                  <p>No tenders assigned to this location yet. Select tenders above to get started.</p>
                </div>
              ) : (
                <div className="data-table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>TENDER NAME</th>
                        <th>CLASSIFICATION</th>
                        <th className="text-center">BUTTON COLOUR</th>
                        <th>TILL ORDER</th>
                        <th className="text-center">STATUS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allTenders
                        .filter((tender) =>
                          locationTenders.some(
                            (id) => id === tender._id || id === tender._id?.toString() || id?.toString() === tender._id?.toString()
                          )
                        )
                        .map((tender, idx) => (
                          <tr key={tender._id}>
                            <td className="font-medium">{tender.name}</td>
                            <td>{tender.classification}</td>
                            <td className="text-center">
                              <div
                                className="w-6 h-6 rounded-full mx-auto border border-gray-300"
                                style={{ backgroundColor: tender.buttonColor }}
                              ></div>
                            </td>
                            <td>{tender.tillOrder}</td>
                            <td className="text-center">
                              <span className="inline-block bg-emerald-100 text-emerald-800 px-2 py-1 rounded-full text-xs font-medium">
                                Assigned
                              </span>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Summary */}
          {selectedLocation && (
            <div className="bg-sky-50 border border-sky-200 rounded-lg p-6 mt-6">
              <h3 className="font-semibold text-sky-900 mb-2">Current Selection Summary</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium text-sky-900">Tenders Enabled</p>
                  <p className="text-2xl font-bold text-sky-600">{locationTenders.length}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-sky-900">Categories Enabled</p>
                  <p className="text-2xl font-bold text-sky-600">{locationCategories.length}</p>
                </div>
              </div>
            </div>
          )}

          {/* Edit Location Modal */}
          {showEditModal && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-xl shadow-lg max-w-md w-full p-6">
                <h2 className="text-xl font-semibold text-gray-900 mb-4">Edit Location</h2>
                
                <div className="space-y-4">
                  <div className="form-group">
                    <label className="form-label">
                      Location Name *
                    </label>
                    <input
                      type="text"
                      value={editFormData.name}
                      onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                      className="form-input"
                      placeholder="e.g., Main Store"
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">
                      Address
                    </label>
                    <input
                      type="text"
                      value={editFormData.address}
                      onChange={(e) => setEditFormData({ ...editFormData, address: e.target.value })}
                      className="form-input"
                      placeholder="e.g., 123 Main Street"
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">
                      Phone
                    </label>
                    <input
                      type="text"
                      value={editFormData.phone}
                      onChange={(e) => setEditFormData({ ...editFormData, phone: e.target.value })}
                      className="form-input"
                      placeholder="e.g., +234 123 456 7890"
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">
                      Email
                    </label>
                    <input
                      type="email"
                      value={editFormData.email}
                      onChange={(e) => setEditFormData({ ...editFormData, email: e.target.value })}
                      className="form-input"
                      placeholder="e.g., store@example.com"
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">
                      Location Code
                    </label>
                    <input
                      type="text"
                      value={editFormData.code}
                      onChange={(e) => setEditFormData({ ...editFormData, code: e.target.value })}
                      className="form-input"
                      placeholder="e.g., LOC001"
                    />
                  </div>
                </div>

                <div className="flex gap-3 mt-6">
                  <button
                    onClick={() => setShowEditModal(false)}
                    className="btn-action-secondary flex-1"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveLocationEdit}
                    disabled={saving || !editFormData.name.trim()}
                    className="btn-action-primary flex-1"
                  >
                    {saving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
