const Video = require("../../../../models/video");

//admin upload video
//method:post
//Endpoints:/upload-videos/video
const createVideo = async (req, res) => {
  try {
    console.log(req.files);
    const data = await Video.create({
      video1:
        req.files.video1 && `/admin/user/video/${req.files.video1[0].filename}`,
      thumbnail1:
        req.files.thumbnail1 &&
        `/admin/user/thumbnail/${req.files.thumbnail1[0].filename}`,
      video2:
        req.files.video2 && `/admin/user/video/${req.files.video2[0].filename}`,
      thumbnail2:
        req.files.thumbnail2 &&
        `/admin/user/thumbnail/${req.files.thumbnail2[0].filename}`,
      video3:
        req.files.video3 && `/admin/user/video/${req.files.video3[0].filename}`,
      thumbnail3:
        req.files.thumbnail3 &&
        `/admin/user/thumbnail/${req.files.thumbnail3[0].filename}`,
      video4:
        req.files.video4 && `/admin/user/video/${req.files.video4[0].filename}`,
      thumbnail4:
        req.files.thumbnail4 &&
        `/admin/user/thumbnail/${req.files.thumbnail4[0].filename}`,
      video5:
        req.files.video5 && `/admin/user/video/${req.files.video5[0].filename}`,
      thumbnail5:
        req.files.thumbnail5 &&
        `/admin/user/thumbnail/${req.files.thumbnail5[0].filename}`,
      video6:
        req.files.video6 && `/admin/user/video/${req.files.video6[0].filename}`,
      thumbnail6:
        req.files.thumbnail6 &&
        `/admin/user/thumbnail/${req.files.thumbnail6[0].filename}`,
      inActive: false, // default active on creation
    });

    return res.send({
      success: 1,
      message: "Created successfully",
    });
  } catch (error) {
    return res.send({
      success: 0,
      message: error.message,
    });
  }
};


const upadateVideo = async (req, res) => {
  try {
    const { id } = req.params;

    console.log('Update request received for ID:', id);
    console.log('Files received:', req.files);

    const admin = await Video.findById(id);

    if (!admin) {
      return res.status(404).send({
        success: 0,
        message: "Video not found",
      });
    }

    const updateData = {};

    if (req.files) {
      for (let i = 1; i <= 6; i++) {
        const fieldName = `video${i}`;
        if (req.files[fieldName] && Array.isArray(req.files[fieldName]) && req.files[fieldName].length > 0) {
          const file = req.files[fieldName][0];
          if (file && file.filename) {
            updateData[fieldName] = `/admin/user/video/${file.filename}`;
            console.log(`Updating ${fieldName} with:`, updateData[fieldName]);
          }
        }
      }
    }

    // Allow inActive toggle via body while updating (optional)
    if (req.body && req.body.inActive !== undefined) {
      updateData.inActive = req.body.inActive === "true" || req.body.inActive === true;
    }

    console.log('Final update data:', updateData);

    if (Object.keys(updateData).length === 0) {
      return res.send({
        success: 0,
        message: "No files or fields provided for update",
      });
    }

    const data = await Video.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    );

    if (!data) {
      return res.send({
        success: 0,
        message: "Failed to update video in database",
      });
    }

    return res.send({
      success: 1,
      message: "Updated successfully",
      data: data
    });

  } catch (error) {
    console.error('Update error:', error);
    return res.status(500).send({
      success: 0,
      message: error.message,
    });
  }
};

// ==================== TOGGLE VIDEO ACTIVE/INACTIVE ====================
//method:patch
//Endpoints:/upload-videos/video-status/:id
const toggleVideoStatus = async (req, res) => {
    try {
      const { id } = req.params;
      const { isActive } = req.body; // expects true or false
  
      const video = await Video.findById(id);
      if (!video) {
        return res.status(404).send({
          success: 0,
          message: "Video not found",
        });
      }
  
      const newStatus = isActive !== undefined ? (isActive === "true" || isActive === true) : !video.isActive;
  
      video.isActive = newStatus;
      await video.save();
  
      return res.send({
        success: 1,
        message: `Video ${newStatus ? "activated" : "deactivated"} successfully`,
        data: video,
      });
    } catch (error) {
      console.error("Toggle video status error:", error);
      return res.status(500).send({
        success: 0,
        message: error.message || "Failed to update video status",
      });
    }
  };

//user get uploaded videos
//method:get
//Endpoints:/upload-videos/getVideo
const getVideo = async (req, res) => {
  try {
    const { inActive } = req.query; // optional filter: /getVideo?inActive=false

    const filter = {};
    if (inActive !== undefined) {
      filter.inActive = inActive === "true";
    }

    const data = await Video.find(filter);
    if (!data) {
      return res.send({
        success: 0,
        message: "Data error",
      });
    }

    return res.send({
      success: 1,
      message: "Fetched",
      details: data,
    });
  } catch (error) {
    return res.send({
      success: 0,
      message: error.message,
    });
  }
};

// ==================== YOUTUBE FUNCTIONS ====================
function extractYouTubeId(url) {
    if (!url || typeof url !== 'string') return null;
  
    // Sirf hash hatao, query string mat hatao — usme hi video id hoti hai
    const cleanUrl = url.split('#')[0];
  
    const patterns = [
      /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/,
      /youtube\.com\/watch\?v=([^"&?\/\s]{11})/,
      /youtu\.be\/([^"&?\/\s]{11})/
    ];
  
    for (const pattern of patterns) {
      const match = cleanUrl.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }
  
    return null;
  }

// Add YouTube Link
const addYoutubeLink = async (req, res) => {
  try {
    const { youtubeUrl, title } = req.body;

    if (!youtubeUrl) {
      return res.status(400).send({
        success: 0,
        message: "YouTube URL is required"
      });
    }

    const videoId = extractYouTubeId(youtubeUrl);
    if (!videoId) {
      return res.status(400).send({
        success: 0,
        message: "Invalid YouTube URL"
      });
    }

    let videoDoc = await Video.findOne();
    if (!videoDoc) {
      videoDoc = await Video.create({});
    }

    const youtubeLink = {
      url: youtubeUrl,
      videoId: videoId,
      thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      title: title || `YouTube Video ${videoDoc.youtubeLinks ? videoDoc.youtubeLinks.length + 1 : 1}`,
      addedAt: new Date(),
      inActive: false, // default active
    };

    if (!videoDoc.youtubeLinks) {
      videoDoc.youtubeLinks = [];
    }

    videoDoc.youtubeLinks.push(youtubeLink);
    await videoDoc.save();

    const savedLink = videoDoc.youtubeLinks[videoDoc.youtubeLinks.length - 1];

    return res.send({
      success: 1,
      message: "YouTube link added successfully",
      data: {
        _id: savedLink._id,
        url: savedLink.url,
        videoId: savedLink.videoId,
        thumbnail: savedLink.thumbnail,
        title: savedLink.title,
        addedAt: savedLink.addedAt,
        inActive: savedLink.inActive,
      },
      totalLinks: videoDoc.youtubeLinks.length
    });

  } catch (error) {
    console.error('Add YouTube error:', error);
    return res.status(500).send({
      success: 0,
      message: error.message || "Failed to add YouTube link"
    });
  }
};

// Get YouTube Links
const getYoutubeLinks = async (req, res) => {
  try {
    const { inActive } = req.query; // optional filter: /get-youtube-links?inActive=false

    const videoDoc = await Video.findOne()
      .sort({ 'youtubeLinks.addedAt': -1 });

    if (!videoDoc) {
      return res.send({
        success: 1,
        message: "No videos found",
        youtubeLinks: [],
        total: 0
      });
    }

    let youtubeLinks = videoDoc.youtubeLinks || [];

    if (inActive !== undefined) {
      const filterValue = inActive === "true";
      youtubeLinks = youtubeLinks.filter(link => link.inActive === filterValue);
    }

    return res.send({
      success: 1,
      message: "YouTube links fetched",
      youtubeLinks: youtubeLinks,
      total: youtubeLinks.length
    });

  } catch (error) {
    console.error('Get YouTube links error:', error);
    return res.status(500).send({
      success: 0,
      message: error.message || "Failed to fetch YouTube links"
    });
  }
};

// Delete YouTube Link
const deleteYoutubeLink = async (req, res) => {
  try {
    const { linkId } = req.params;

    const videoDoc = await Video.findOne();
    if (!videoDoc) {
      return res.status(404).send({
        success: 0,
        message: "Video document not found"
      });
    }

    const youtubeLinks = videoDoc.youtubeLinks || [];
    const initialLength = youtubeLinks.length;

    videoDoc.youtubeLinks = youtubeLinks.filter(
      link => link._id.toString() !== linkId
    );

    if (videoDoc.youtubeLinks.length === initialLength) {
      return res.status(404).send({
        success: 0,
        message: "YouTube link not found"
      });
    }

    await videoDoc.save();

    return res.send({
      success: 1,
      message: "YouTube link deleted successfully",
      remainingLinks: videoDoc.youtubeLinks.length
    });

  } catch (error) {
    console.error('Delete YouTube link error:', error);
    return res.status(500).send({
      success: 0,
      message: error.message || "Failed to delete YouTube link"
    });
  }
};

// Update YouTube Link
const updateYoutubeLink = async (req, res) => {
  try {
    const { linkId } = req.params;
    const { youtubeUrl, title } = req.body;

    if (!youtubeUrl) {
      return res.status(400).send({
        success: 0,
        message: "YouTube URL is required"
      });
    }

    const videoId = extractYouTubeId(youtubeUrl);
    if (!videoId) {
      return res.status(400).send({
        success: 0,
        message: "Invalid YouTube URL"
      });
    }

    const videoDoc = await Video.findOne();
    if (!videoDoc) {
      return res.status(404).send({
        success: 0,
        message: "Video document not found"
      });
    }

    const youtubeLinks = videoDoc.youtubeLinks || [];
    const linkIndex = youtubeLinks.findIndex(
      link => link._id.toString() === linkId
    );

    if (linkIndex === -1) {
      return res.status(404).send({
        success: 0,
        message: "YouTube link not found"
      });
    }

    youtubeLinks[linkIndex].url = youtubeUrl;
    youtubeLinks[linkIndex].videoId = videoId;
    youtubeLinks[linkIndex].thumbnail = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
    if (title) youtubeLinks[linkIndex].title = title;

    await videoDoc.save();

    return res.send({
      success: 1,
      message: "YouTube link updated successfully",
      data: youtubeLinks[linkIndex]
    });

  } catch (error) {
    console.error('Update YouTube link error:', error);
    return res.status(500).send({
      success: 0,
      message: error.message || "Failed to update YouTube link"
    });
  }
};


// ==================== TOGGLE YOUTUBE LINK ACTIVE/INACTIVE ====================
//method:patch
//Endpoints:/upload-videos/youtube-status/:linkId
const toggleYoutubeLinkStatus = async (req, res) => {
    try {
      const { linkId } = req.params;
      const { isActive } = req.body; // expects true or false, optional
  
      const videoDoc = await Video.findOne();
      if (!videoDoc) {
        return res.status(404).send({
          success: 0,
          message: "Video document not found"
        });
      }
  
      const youtubeLinks = videoDoc.youtubeLinks || [];
      const linkIndex = youtubeLinks.findIndex(
        link => link._id.toString() === linkId
      );
  
      if (linkIndex === -1) {
        return res.status(404).send({
          success: 0,
          message: "YouTube link not found"
        });
      }
  
      const newStatus = isActive !== undefined
        ? (isActive === "true" || isActive === true)
        : !youtubeLinks[linkIndex].isActive;
  
      youtubeLinks[linkIndex].isActive = newStatus;
      await videoDoc.save();
  
      return res.send({
        success: 1,
        message: `YouTube link ${newStatus ? "activated" : "deactivated"} successfully`,
        data: youtubeLinks[linkIndex],
      });
  
    } catch (error) {
      console.error("Toggle YouTube link status error:", error);
      return res.status(500).send({
        success: 0,
        message: error.message || "Failed to update YouTube link status",
      });
    }
  };

module.exports = {
  createVideo,
  getVideo,
  upadateVideo,
  toggleVideoStatus,
  addYoutubeLink,
  getYoutubeLinks,
  deleteYoutubeLink,
  updateYoutubeLink,
  toggleYoutubeLinkStatus,
};