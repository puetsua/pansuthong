use std::sync::Mutex;

use crate::models::UpdateInfo;

pub struct PendingUpdate(pub Mutex<Option<UpdateInfo>>);
