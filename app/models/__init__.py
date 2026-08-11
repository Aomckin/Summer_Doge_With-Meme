"""Single registration entry point for every SQLAlchemy model."""

from .ai_analysis import MemeAIAnalysis
from .ai_settings import AIModel, AIProvider
from .caption import Caption
from .embedding_job import EmbeddingJob, EmbeddingJobItem
from .enrichment import EnrichmentAudit, EnrichmentJob, EnrichmentJobItem, MemeEnrichmentSuggestion
from .export_job import ExportJob, ExportJobItem
from .import_job import ImportJob, ImportJobItem
from .meme import Meme
from .meme_embedding import MemeEmbedding, SemanticIndexState
from .meme_image import MemeImage
from .meme_relation import MemeRelation
from .tag import MemeTag, Tag
from .template import Template

__all__ = [
    "AIModel", "AIProvider", "Caption", "EmbeddingJob", "EmbeddingJobItem",
    "EnrichmentAudit", "EnrichmentJob", "EnrichmentJobItem",
    "ExportJob", "ExportJobItem", "ImportJob", "ImportJobItem", "Meme",
    "MemeAIAnalysis", "MemeEmbedding", "MemeEnrichmentSuggestion", "MemeImage", "MemeRelation",
    "MemeTag", "SemanticIndexState", "Tag", "Template",
]
