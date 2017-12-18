/**
 * Common services for displaying incident notes
 */
BM.angularApp.service('BM.services.incidentNote', function() {
	this.getNoteListItemClass = function(noteID)
	{
		if (noteID === BM.IncidentNote.getCurrentNoteID())
			return 'selected';
		else
			return '';
	};

	this.getNoteStatusClass = function(status)
	{
		var noteStatusClass;
		switch (status)
		{
			case -1:
				noteStatusClass = "pending";
				break;
			case 0:
				noteStatusClass = "rejected";
				break;
			case 1:
				noteStatusClass = "approved";
				break;
		}

		return noteStatusClass;
	};

	this.displayNote = function(noteID, ui)
	{
		BM.IncidentNote.displayNote(noteID);
	};

	this.getNoteBody = function(body)
	{
		var noteBody = $('<pre>' + body + '</pre>');
		return noteBody.text();
	};

	this.getCreationDate = function(data)
	{
		return moment(data._source.Created).calendar();
	};

	this.getCommentCount = function(data)
	{
		return data._source.Comments.filter(function(comment) { return comment.ID !== undefined; }).length;
	}
});