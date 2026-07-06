"use client";

import Layout from "@/components/Layout";
import { useState, useEffect } from "react";
import axios from "axios";
import { showAlertDialog, showConfirmDialog } from "@/lib/dialogs";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faTrash,
  faEdit,
  faPlus,
  faImages,
  faSave,
  faTimes,
  faBoxOpen,
  faMugHot,
  faUtensils,
  faBed,
  faCouch,
  faChair,
  faTags,
  faScrewdriverWrench,
  faShirt,
  faGift,
} from "@fortawesome/free-solid-svg-icons";
import Loader from "@/components/Loader";
import { getCachedCategories, invalidateCategoriesCache } from "@/lib/categoriesCache";

const ICON_OPTIONS = [
  { value: "", label: "No Icon", icon: faImages },
  { value: "box", label: "Box", icon: faBoxOpen },
  { value: "drink", label: "Drink", icon: faMugHot },
  { value: "food", label: "Food", icon: faUtensils },
  { value: "bed", label: "Bed/Room", icon: faBed },
  { value: "lounge", label: "Lounge", icon: faCouch },
  { value: "furniture", label: "Furniture", icon: faChair },
  { value: "tag", label: "General", icon: faTags },
  { value: "tools", label: "Tools", icon: faScrewdriverWrench },
  { value: "clothing", label: "Clothing", icon: faShirt },
  { value: "gift", label: "Gift", icon: faGift },
];

function resolveCategoryIcon(iconKey) {
  const found = ICON_OPTIONS.find((opt) => opt.value === iconKey);
  return found?.icon || faImages;
}

export default function Categories() {
  const [name, setName] = useState("");
  const [images, setImages] = useState([]);
  const [categories, setCategories] = useState([]);
  const [parentCategory, setParentCategory] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [icon, setIcon] = useState("");
  const [isStockManaged, setIsStockManaged] = useState(true);
  const [editIndex, setEditIndex] = useState(null);
  const [editedCategory, setEditedCategory] = useState({
    name: "",
    parentCategory: "",
    icon: "",
    isStockManaged: true,
    images: [],
    properties: [],
  });
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedLocations, setSelectedLocations] = useState([]);
  const [allLocations, setAllLocations] = useState([]);

  // ✅ Fetch categories once
  useEffect(() => {
    (async () => {
      try {
        const data = await getCachedCategories();
        setCategories(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error(err);
        void showAlertDialog({
          title: "Load failed",
          message: "Failed to fetch categories.",
          tone: "danger",
        });
      }
    })();
  }, []);

  // Fetch locations
  useEffect(() => {
    axios.get("/api/setup/get")
      .then((res) => {
        const store = res.data?.store;
        if (store?.locations && Array.isArray(store.locations)) {
          setAllLocations(store.locations.map((loc) => loc.name || loc));
        }
      })
      .catch(() => {});
  }, []);

  // ✅ Image upload handler
  const uploadImage = async (e, isEdit = false) => {
    const files = e.target.files;
    if (!files?.length) return;

    const previews = Array.from(files).map((file) => ({
      full: URL.createObjectURL(file),
      thumb: URL.createObjectURL(file),
      isTemp: true,
    }));

    // Show previews immediately (append to existing for edit mode)
    if (isEdit)
      setEditedCategory((prev) => ({ ...prev, images: [...prev.images, ...previews] }));
    else setImages((prev) => [...prev, ...previews]);

    const formData = new FormData();
    Array.from(files).forEach((f) => formData.append("file", f));

    setLoading(true);
    try {
      const res = await axios.post("/api/upload", formData);
      const uploaded = res.data?.links || [];
      const formatted = uploaded.map((link) => ({
        full: link.full || link,
        thumb: link.thumb || link,
      }));

      if (isEdit) {
        // Replace temp previews with actual uploaded URLs (keep existing images intact)
        setEditedCategory((prev) => ({
          ...prev,
          images: [...prev.images.filter((img) => !img.isTemp), ...formatted],
        }));
      } else {
        setImages((prev) => [...prev.filter((img) => !img.isTemp), ...formatted]);
      }
    } catch (err) {
      console.error(err);
      // Remove temp previews on failure
      if (isEdit) {
        setEditedCategory((prev) => ({
          ...prev,
          images: prev.images.filter((img) => !img.isTemp),
        }));
      } else {
        setImages((prev) => prev.filter((img) => !img.isTemp));
      }
      await showAlertDialog({
        title: "Upload failed",
        message: "Image upload failed.",
        tone: "danger",
      });
    } finally {
      setLoading(false);
    }
  };

  const removeImage = (index, isEdit = false) => {
    if (isEdit)
      setEditedCategory((prev) => ({
        ...prev,
        images: prev.images.filter((_, i) => i !== index),
      }));
    else setImages((prev) => prev.filter((_, i) => i !== index));
  };

  // ✅ Add, remove, and edit property pairs
  const addProperty = (isEdit = false) => {
    const newProp = { propName: "", propValue: "" };
    if (isEdit)
      setEditedCategory((prev) => ({
        ...prev,
        properties: [...prev.properties, newProp],
      }));
    else setProperties((prev) => [...prev, newProp]);
  };

  const handlePropertyChange = (index, key, value, isEdit = false) => {
    if (isEdit) {
      setEditedCategory((prev) => {
        const updated = [...prev.properties];
        updated[index][key] = value;
        return { ...prev, properties: updated };
      });
    } else {
      setProperties((prev) => {
        const updated = [...prev];
        updated[index][key] = value;
        return updated;
      });
    }
  };

  const removeProperty = (index, isEdit = false) => {
    if (isEdit)
      setEditedCategory((prev) => ({
        ...prev,
        properties: prev.properties.filter((_, i) => i !== index),
      }));
    else setProperties((prev) => prev.filter((_, i) => i !== index));
  };

  // ✅ Save New Category
  const saveCategory = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      await showAlertDialog({
        title: "Category name required",
        message: "Category name is required.",
        tone: "warning",
      });
      return;
    }

    const formattedImages = images.map((img) => ({
      full: img.full,
      thumb: img.thumb,
    }));

    try {
      const res = await axios.post("/api/categories", {
        name,
        parentCategory: parentCategory || null,
        icon: icon.trim(),
        isStockManaged,
        images: formattedImages,
        properties,
        locations: selectedLocations,
      });
      invalidateCategoriesCache();
      setCategories((prev) => [...prev, res.data]);
      setName("");
      setParentCategory("");
      setIcon("");
      setIsStockManaged(true);
      setImages([]);
      setProperties([]);
      setSelectedLocations([]);
    } catch (err) {
      console.error(err);
      await showAlertDialog({
        title: "Save failed",
        message: "Failed to save category.",
        tone: "danger",
      });
    }
  };

  // ✅ Edit & Update
  const handleEditClick = (index, cat) => {
    setEditIndex(index);
    setEditedCategory({
      _id: cat._id,
      name: cat.name,
      parentCategory: cat.parent?._id || "",
      icon: cat.icon || "",
      isStockManaged: cat.isStockManaged !== false,
      images: cat.images || [],
      properties: cat.properties || [],
      locations: cat.locations || [],
    });
  };

  const handleUpdateClick = async (id) => {
    if (!editedCategory.name.trim()) {
      await showAlertDialog({
        title: "Category name required",
        message: "Category name is required.",
        tone: "warning",
      });
      return;
    }

    // Only send fully uploaded images (exclude temp previews still uploading)
    const formattedImages = editedCategory.images
      .filter((img) => !img.isTemp)
      .map((img) => ({
        full: img.full,
        thumb: img.thumb,
      }));

    try {
      const res = await axios.put("/api/categories", {
        _id: id,
        ...editedCategory,
        images: formattedImages,
        locations: editedCategory.locations || [],
      });
      invalidateCategoriesCache();
      setCategories((prev) =>
        prev.map((cat) => (cat._id === id ? res.data : cat))
      );
      setEditIndex(null);
      setEditedCategory({
        name: "",
        parentCategory: "",
        icon: "",
        isStockManaged: true,
        images: [],
        properties: [],
        locations: [],
      });
    } catch (err) {
      console.error(err);
      await showAlertDialog({
        title: "Update failed",
        message: "Failed to update category.",
        tone: "danger",
      });
    }
  };

  const handleDelete = async (id) => {
    const shouldDelete = await showConfirmDialog({
      title: "Delete category?",
      message: "This category will be removed permanently.",
      tone: "danger",
      confirmLabel: "Delete category",
      cancelLabel: "Keep category",
    });
    if (!shouldDelete) return;
    try {
      await axios.delete("/api/categories?id=" + id);
      invalidateCategoriesCache();
      setCategories((prev) => prev.filter((c) => c._id !== id));
    } catch (err) {
      console.error(err);
      await showAlertDialog({
        title: "Delete failed",
        message: "Delete failed.",
        tone: "danger",
      });
    }
  };

  const filteredCategories = categories.filter((cat) =>
    cat.name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <Layout>
      <div className="page-container">
        <div className="page-content space-y-6">
          {/* Header */}
          <div className="page-header flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <h1 className="page-title">Categories</h1>
            <div className="search-input-wrapper w-full sm:w-64">
              <input
                type="text"
                placeholder="Search categories..."
                className="search-input !pl-4"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          {/* Add Category */}
          <div className="content-card">
            <form onSubmit={saveCategory} className="space-y-6">
              <div className="content-card-header flex items-center gap-2">
                <FontAwesomeIcon icon={faPlus} className="text-sky-600" />
                <h2 className="text-lg font-semibold text-gray-900">
                  Add New Category
                </h2>
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                <div className="form-group">
                  <label className="form-label">
                    Category Name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Enter category name"
                    className="form-input"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">
                    Parent Category
                  </label>
                  <select
                    value={parentCategory}
                    onChange={(e) => setParentCategory(e.target.value)}
                    className="form-select"
                  >
                    <option value="">No Parent</option>
                    {categories.map((cat) => (
                      <option key={cat._id} value={cat._id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Icon</label>
                  <select
                    value={icon}
                    onChange={(e) => setIcon(e.target.value)}
                    className="form-select"
                  >
                    {ICON_OPTIONS.map((opt) => (
                      <option key={opt.value || "none"} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group flex items-end">
                  <label className="inline-flex items-center gap-2 text-sm text-gray-700 py-2">
                    <input
                      type="checkbox"
                      checked={isStockManaged}
                      onChange={(e) => setIsStockManaged(e.target.checked)}
                    />
                    Track stock for this category
                  </label>
                </div>
              </div>

              {/* Location Assignment */}
              <div className="form-group">
                <label className="form-label">Available at Locations</label>
                <p className="text-xs text-gray-400 mb-2">Leave empty to make available at all locations.</p>
                <div className="space-y-2">
                  <select
                    className="form-select"
                    value=""
                    onChange={(e) => {
                      const loc = e.target.value;
                      if (loc && !selectedLocations.includes(loc)) {
                        setSelectedLocations((prev) => [...prev, loc]);
                      }
                    }}
                  >
                    <option value="">— Select location —</option>
                    {allLocations
                      .filter((loc) => !selectedLocations.includes(loc))
                      .map((loc) => (
                        <option key={loc} value={loc}>{loc}</option>
                      ))}
                  </select>
                  {selectedLocations.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {selectedLocations.map((loc) => (
                        <span key={loc} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium">
                          {loc}
                          <button type="button" onClick={() => setSelectedLocations((prev) => prev.filter((l) => l !== loc))} className="hover:text-red-500 transition-colors">×</button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Image Upload */}
              <div className="form-group">
                <label className="form-label mb-2">
                  Images
                </label>
                <div className="flex flex-wrap gap-3">
                  <label className="btn-action-primary cursor-pointer inline-flex items-center gap-2">
                    <FontAwesomeIcon icon={faImages} />
                    Upload
                    <input
                      type="file"
                      multiple
                      className="hidden"
                      onChange={uploadImage}
                    />
                  </label>
                  {loading && <Loader />}
                  {images.map((img, i) => (
                    <div key={i} className="relative group">
                      <img
                        src={img.thumb || img.full}
                        className="w-16 h-16 object-cover rounded-md border"
                      />
                      <button
                        type="button"
                        onClick={() => removeImage(i)}
                        className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full px-1 opacity-0 group-hover:opacity-100 transition"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <button
                type="submit"
                className="btn-action-primary"
              >
                Save Category
              </button>
            </form>
          </div>

          {/* Table Section */}
          <div className="data-table-container p-0">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Image</th>
                  <th>Icon</th>
                  <th>Name</th>
                  <th>Parent</th>
                  <th>Properties</th>
                  <th>Locations</th>
                  <th className="text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredCategories.map((cat, i) => (
                  <tr key={cat._id} className="border-b hover:bg-gray-50">
                    <td className="p-3">
                      {cat.images && cat.images.length > 0 ? (
                        <img
                          src={cat.images[0].thumb || cat.images[0].full}
                          alt={cat.name}
                          className="w-12 h-12 object-cover rounded-md border border-gray-200"
                        />
                      ) : (
                        <div className="w-12 h-12 bg-gray-100 rounded-md border border-gray-200 flex items-center justify-center text-gray-400">
                          <FontAwesomeIcon icon={resolveCategoryIcon(cat.icon)} />
                        </div>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="w-10 h-10 bg-gray-100 rounded-md border border-gray-200 flex items-center justify-center text-gray-500">
                        <FontAwesomeIcon icon={resolveCategoryIcon(cat.icon)} />
                      </div>
                    </td>
                    <td className="p-3 font-medium text-gray-900">
                      {cat.name}
                      {cat.isStockManaged === false && (
                        <span className="ml-2 text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                          Non-stock
                        </span>
                      )}
                    </td>
                    <td className="p-3">{cat.parent?.name || "-"}</td>
                    <td className="p-3">
                      {(cat.properties || []).map((p, k) => (
                        <span
                          key={k}
                          className="bg-cyan-100 text-cyan-700 text-xs px-2 py-1 rounded-md border border-cyan-300 mr-2"
                        >
                          {p.propName}: {p.propValue}
                        </span>
                      ))}
                    </td>
                    <td className="p-3">
                      {(cat.locations || []).length === 0 ? (
                        <span className="text-xs text-gray-400">All locations</span>
                      ) : (
                        (cat.locations || []).map((loc, k) => (
                          <span key={k} className="bg-emerald-100 text-emerald-700 text-xs px-2 py-1 rounded-md border border-emerald-300 mr-1 mb-1 inline-block">{loc}</span>
                        ))
                      )}
                    </td>
                    <td className="p-3 flex justify-center gap-3">
                      <button
                        onClick={() => handleEditClick(i, cat)}
                        className="py-1 px-3 rounded bg-cyan-600 text-white text-xs font-medium hover:bg-cyan-700 transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(cat._id)}
                        className="py-1 px-3 rounded bg-red-500 text-white text-xs font-medium hover:bg-red-600 transition-colors"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredCategories.length === 0 && (
                  <tr>
                    <td
                      colSpan="7"
                      className="p-4 text-center text-gray-400"
                    >
                      No categories found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Edit Modal */}
          {editIndex !== null && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                <div className="p-6 space-y-6">
                  {/* Header */}
                  <div className="flex items-center justify-between border-b pb-4">
                    <h2 className="text-2xl font-bold text-gray-900">Edit Category</h2>
                    <button
                      onClick={() => setEditIndex(null)}
                      className="text-gray-500 hover:text-gray-700"
                    >
                      <FontAwesomeIcon icon={faTimes} size="lg" />
                    </button>
                  </div>

                  {/* Form */}
                  <div className="space-y-6">
                    <div className="grid md:grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-cyan-700 mb-2">
                          Category Name
                        </label>
                        <input
                          type="text"
                          value={editedCategory.name}
                          onChange={(e) =>
                            setEditedCategory((prev) => ({
                              ...prev,
                              name: e.target.value,
                            }))
                          }
                          placeholder="Enter category name"
                          className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-cyan-600 focus:border-transparent"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-cyan-700 mb-2">
                          Parent Category
                        </label>
                        <select
                          value={editedCategory.parentCategory}
                          onChange={(e) =>
                            setEditedCategory((prev) => ({
                              ...prev,
                              parentCategory: e.target.value,
                            }))
                          }
                          className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-cyan-600 focus:border-transparent"
                        >
                          <option value="">No Parent</option>
                          {categories
                            .filter((c) => c._id !== editedCategory._id)
                            .map((cat) => (
                              <option key={cat._id} value={cat._id}>
                                {cat.name}
                              </option>
                            ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-cyan-700 mb-2">
                          Icon
                        </label>
                        <select
                          value={editedCategory.icon || ""}
                          onChange={(e) =>
                            setEditedCategory((prev) => ({
                              ...prev,
                              icon: e.target.value,
                            }))
                          }
                          className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-cyan-600 focus:border-transparent"
                        >
                          {ICON_OPTIONS.map((opt) => (
                            <option key={opt.value || "none"} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="md:col-span-2">
                        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                          <input
                            type="checkbox"
                            checked={editedCategory.isStockManaged !== false}
                            onChange={(e) =>
                              setEditedCategory((prev) => ({
                                ...prev,
                                isStockManaged: e.target.checked,
                              }))
                            }
                          />
                          Track stock for this category
                        </label>
                      </div>

                      {/* Locations in edit modal */}
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-cyan-700 mb-2">Available at Locations</label>
                        <p className="text-xs text-gray-400 mb-2">Leave empty to make available at all locations.</p>
                        <select
                          className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-cyan-600 focus:border-transparent mb-2"
                          value=""
                          onChange={(e) => {
                            const loc = e.target.value;
                            if (loc && !(editedCategory.locations || []).includes(loc)) {
                              setEditedCategory((prev) => ({ ...prev, locations: [...(prev.locations || []), loc] }));
                            }
                          }}
                        >
                          <option value="">— Select location —</option>
                          {allLocations
                            .filter((loc) => !(editedCategory.locations || []).includes(loc))
                            .map((loc) => (
                              <option key={loc} value={loc}>{loc}</option>
                            ))}
                        </select>
                        {(editedCategory.locations || []).length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {editedCategory.locations.map((loc) => (
                              <span key={loc} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium">
                                {loc}
                                <button type="button" onClick={() => setEditedCategory((prev) => ({ ...prev, locations: prev.locations.filter((l) => l !== loc) }))} className="hover:text-red-500 transition-colors">×</button>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Image Upload */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Images
                      </label>
                      <div className="flex flex-wrap items-center gap-3 p-4 bg-gray-50 rounded-lg border border-dashed border-gray-300">
                        {editedCategory.images?.map((img, i) => (
                          <div key={i} className="relative group w-20 h-20">
                            <img
                              src={img.thumb || img.full}
                              alt={`Category ${i + 1}`}
                              className={`w-20 h-20 object-cover rounded-lg border-2 ${img.isTemp ? "border-amber-300 opacity-70" : "border-gray-200"} shadow-sm`}
                            />
                            {img.isTemp && (
                              <div className="absolute inset-0 flex items-center justify-center">
                                <div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={() => removeImage(i, true)}
                              className="absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 text-white text-xs rounded-full w-6 h-6 flex items-center justify-center shadow-md transition-all opacity-0 group-hover:opacity-100"
                              title="Remove image"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                        <label className="flex flex-col items-center justify-center w-20 h-20 border-2 border-dashed border-cyan-300 rounded-lg cursor-pointer hover:border-cyan-500 hover:bg-cyan-50 transition-colors">
                          <FontAwesomeIcon icon={faImages} className="text-cyan-500 text-lg mb-1" />
                          <span className="text-[10px] text-cyan-600 font-medium">Add</span>
                          <input
                            type="file"
                            multiple
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => uploadImage(e, true)}
                          />
                        </label>
                        {loading && <Loader />}
                      </div>
                      {editedCategory.images?.length > 0 && (
                        <p className="text-xs text-gray-400 mt-2">
                          {editedCategory.images.filter((img) => !img.isTemp).length} image{editedCategory.images.filter((img) => !img.isTemp).length !== 1 ? "s" : ""} • Hover to remove
                        </p>
                      )}
                    </div>

                    {/* Properties */}
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <label className="text-sm font-medium text-gray-700">
                          Properties
                        </label>
                        <button
                          type="button"
                          onClick={() => addProperty(true)}
                          className="text-cyan-600 hover:text-cyan-700 text-sm font-medium"
                        >
                          + Add Property
                        </button>
                      </div>
                      <div className="space-y-3">
                        {editedCategory.properties?.map((prop, i) => (
                          <div key={i} className="flex gap-2">
                            <input
                              type="text"
                              placeholder="Property name"
                              value={prop.propName || ""}
                              onChange={(e) =>
                                handlePropertyChange(
                                  i,
                                  "propName",
                                  e.target.value,
                                  true
                                )
                              }
                              className="flex-1 border rounded-lg px-3 py-2 focus:ring-2 focus:ring-cyan-600 focus:border-transparent"
                            />
                            <input
                              type="text"
                              placeholder="Property value"
                              value={prop.propValue || ""}
                              onChange={(e) =>
                                handlePropertyChange(
                                  i,
                                  "propValue",
                                  e.target.value,
                                  true
                                )
                              }
                              className="flex-1 border rounded-lg px-3 py-2 focus:ring-2 focus:ring-cyan-600 focus:border-transparent"
                            />
                            <button
                              type="button"
                              onClick={() => removeProperty(i, true)}
                              className="text-red-500 hover:text-red-700 px-3 py-2"
                            >
                              <FontAwesomeIcon icon={faTrash} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="flex gap-3 border-t pt-4">
                    <button
                      onClick={() => setEditIndex(null)}
                      className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleUpdateClick(editedCategory._id)}
                      className="flex-1 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg transition flex items-center justify-center gap-2"
                    >
                      <FontAwesomeIcon icon={faSave} />
                      Save Changes
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}

