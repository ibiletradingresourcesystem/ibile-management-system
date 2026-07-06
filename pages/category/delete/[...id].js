import Layout from "@/components/Layout";
import axios from "axios";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { invalidateCategoriesCache } from "@/lib/categoriesCache";
import { showAlertDialog } from "@/lib/dialogs";

export default function DeleteCategoryPage() {
  const router = useRouter();
  const [categoryInfo, setCategoryInfo] = useState();
  const { id } = router.query;

  useEffect(() => {
    if (!id) return;
    axios.get(`/api/categories?id=${id}`).then((res) => {
      setCategoryInfo(res.data);
    }).catch((err) => {
      console.error("Failed to fetch category:", err);
      void showAlertDialog({
        title: "Load failed",
        message: "Could not fetch category details.",
        tone: "danger",
      });
    });
  }, [id]);

  function goBack() {
    router.push("/manage/categories");
  }

  // Handle Delete Categories
  const handleDeleteClick = async () => {
    try {
      await axios.delete(`/api/categories?id=${id}`);
      invalidateCategoriesCache();
      goBack();
    } catch (error) {
      console.error("Failed to delete category:", error);
      await showAlertDialog({
        title: "Delete failed",
        message: "Failed to delete category. Please try again.",
        tone: "danger",
      });
    }
  };

  return (
    <Layout>
      <div className="page-container">
        <div className="page-content flex items-center justify-center min-h-[60vh]">
          <div className="content-card max-w-md w-full text-center">
            <div className="text-5xl mb-4">⚠️</div>
            <h1 className="text-2xl font-semibold text-gray-800 mb-4">
              Confirm Deletion
            </h1>
            <p className="text-gray-600 mb-8">
              Are you sure you want to delete <strong>{categoryInfo?.name || "this category"}</strong>?
            </p>
            <div className="flex justify-center gap-4">
              <button
                onClick={handleDeleteClick}
                className="btn-action btn-action-danger"
              >
                Yes, Delete
              </button>
              <button
                onClick={goBack}
                className="btn-action btn-action-secondary"
              >
                No, Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
