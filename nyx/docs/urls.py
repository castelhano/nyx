from django.urls import path

from .views import DocView, DocSearchView

app_name = "docs"

urlpatterns = [
    path("search/", DocSearchView.as_view(), name="search"),
    path("<path:doc_path>", DocView.as_view(), name="doc"),
]
