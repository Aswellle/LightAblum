#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SortField {
    CreatedAt,
    FileName,
    FileSize,
}

impl SortField {
    pub fn column_name(&self) -> &'static str {
        match self {
            SortField::CreatedAt => "created_at",
            SortField::FileName  => "file_name",
            SortField::FileSize  => "file_size",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "file_name" => SortField::FileName,
            "file_size" => SortField::FileSize,
            _           => SortField::CreatedAt,
        }
    }
}
